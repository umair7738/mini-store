import { randomBytes } from "node:crypto";
import { Router } from "express";
import { pool } from "./db.js";
import { hashToken } from "./auth.js";
import { HttpError, id, integer, object } from "./validation.js";

export const cartRouter = Router();
const cookieName = "mini_cart";
const cookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/api",
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

export async function getCart(
  req,
  res,
  db = pool,
  { create = false, lock = false } = {},
) {
  const token = req.cookies[cookieName];
  if (token) {
    const [rows] = await db.execute(
      `SELECT id, status, expires_at FROM carts WHERE token_hash = ? ${lock ? "FOR UPDATE" : ""}`,
      [hashToken(token)],
    );
    if (rows.length) {
      const cart = rows[0];
      if (cart.status === "active" && cart.expires_at <= new Date()) {
        await db.execute(
          "UPDATE carts SET status = 'expired' WHERE id = ? AND status = 'active'",
          [cart.id],
        );
        cart.status = "expired";
      }
      if (cart.status === "active") return cart;
      if (!create)
        throw new HttpError(
          409,
          "CART_CLOSED",
          "This cart is no longer active",
        );
    }
  }
  if (!create) throw new HttpError(404, "CART_EMPTY", "Cart not found");
  const newToken = randomBytes(32).toString("base64url");
  const [result] = await db.execute(
    "INSERT INTO carts (token_hash, expires_at) VALUES (?, DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 30 DAY))",
    [hashToken(newToken)],
  );
  res.cookie(cookieName, newToken, cookieOptions);
  return { id: result.insertId, status: "active" };
}

export async function cartSummary(db, cartId) {
  const [rows] = await db.execute(
    `SELECT ci.variant_id, ci.quantity, v.sku, v.label, v.price_fils, v.stock,
            v.is_active AS variant_active, p.is_active AS product_active, p.name, p.slug
     FROM cart_items ci JOIN product_variants v ON v.id = ci.variant_id
     JOIN products p ON p.id = v.product_id WHERE ci.cart_id = ? ORDER BY ci.variant_id`,
    [cartId],
  );
  const items = rows.map((row) => ({
    variantId: row.variant_id,
    quantity: row.quantity,
    sku: row.sku,
    variantLabel: row.label,
    productName: row.name,
    productSlug: row.slug,
    priceFils: row.price_fils,
    lineTotalFils: row.price_fils * row.quantity,
    stock: row.stock,
    available: Boolean(row.variant_active && row.product_active),
  }));
  return {
    items,
    totalFils: items.reduce((sum, item) => sum + item.lineTotalFils, 0),
  };
}

cartRouter.get("/", async (req, res) => {
  const cart = await getCart(req, res, pool, { create: true });
  res.json(await cartSummary(pool, cart.id));
});

async function changeCart(req, res, action) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const cart = await getCart(req, res, connection, {
      create: action === "add",
      lock: true,
    });
    const variantId =
      action === "add" ? id(req.body.variantId) : id(req.params.variantId);
    if (action !== "remove") {
      const [variants] = await connection.execute(
        `SELECT v.stock FROM product_variants v JOIN products p ON p.id = v.product_id
         WHERE v.id = ? AND v.is_active = 1 AND p.is_active = 1 FOR UPDATE`,
        [variantId],
      );
      if (!variants.length)
        throw new HttpError(404, "NOT_FOUND", "Variant not available");
      const quantity = integer(req.body.quantity, "Quantity", 1, 99);
      const [existing] = await connection.execute(
        "SELECT quantity FROM cart_items WHERE cart_id = ? AND variant_id = ? FOR UPDATE",
        [cart.id, variantId],
      );
      const nextQuantity =
        action === "add" ? (existing[0]?.quantity || 0) + quantity : quantity;
      if (nextQuantity > 99 || nextQuantity > variants[0].stock) {
        throw new HttpError(
          409,
          "INSUFFICIENT_STOCK",
          "Requested quantity is unavailable",
        );
      }
      if (existing.length) {
        await connection.execute(
          "UPDATE cart_items SET quantity = ? WHERE cart_id = ? AND variant_id = ?",
          [nextQuantity, cart.id, variantId],
        );
      } else if (action === "add") {
        await connection.execute(
          "INSERT INTO cart_items (cart_id, variant_id, quantity) VALUES (?, ?, ?)",
          [cart.id, variantId, nextQuantity],
        );
      } else {
        throw new HttpError(404, "NOT_FOUND", "Item not in cart");
      }
    } else {
      const [result] = await connection.execute(
        "DELETE FROM cart_items WHERE cart_id = ? AND variant_id = ?",
        [cart.id, variantId],
      );
      if (!result.affectedRows)
        throw new HttpError(404, "NOT_FOUND", "Item not in cart");
    }
    const summary = await cartSummary(connection, cart.id);
    await connection.commit();
    res.status(action === "add" ? 201 : 200).json(summary);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

cartRouter.post("/items", async (req, res) => {
  object(req.body);
  await changeCart(req, res, "add");
});
cartRouter.patch("/items/:variantId", async (req, res) => {
  object(req.body);
  await changeCart(req, res, "update");
});
cartRouter.delete("/items/:variantId", async (req, res) => {
  await changeCart(req, res, "remove");
});
