import { createHmac } from "node:crypto";
import { Router } from "express";
import { pool } from "./db.js";
import { getCart } from "./cart.js";
import { hashToken } from "./auth.js";
import { HttpError, email, integer, object, phone, string } from "./validation.js";

export const checkoutRouter = Router();

function makeConfirmationToken(idempotencyKey) {
  // shortcut: CSRF_SECRET must stay stable for the 24-hour retry window; encrypt stored tokens if rotation must preserve retries.
  return createHmac("sha256", process.env.CSRF_SECRET)
    .update(`order-confirmation:${idempotencyKey}`)
    .digest("base64url");
}

function sameRequest(order, input) {
  return (
    order.customer_name === input.name &&
    order.customer_email === input.email &&
    order.customer_phone === input.phone &&
    order.customer_address === input.address &&
    order.total_fils === input.expectedTotalFils
  );
}

async function findExistingOrder(db, idempotencyKey) {
  const [rows] = await db.execute(
    `SELECT id, customer_name, customer_email, customer_phone, customer_address,
            total_fils FROM orders WHERE idempotency_key = ?`,
    [idempotencyKey],
  );
  return rows[0];
}

function replayOrReject(order, input, res) {
  if (!sameRequest(order, input)) {
    throw new HttpError(
      409,
      "IDEMPOTENCY_CONFLICT",
      "This idempotency key was already used with different checkout details",
    );
  }
  return res.status(200).json({
    orderId: order.id,
    confirmationToken: makeConfirmationToken(input.idempotencyKey),
    totalFils: order.total_fils,
    replayed: true,
  });
}

checkoutRouter.post("/", async (req, res) => {
  object(req.body);
  const name = string(req.body.name, "Name");
  const address = string(req.body.address, "Address", 500, 10);
  const customerEmail = email(req.body.email);
  const customerPhone = phone(req.body.phone);
  const idempotencyKey = string(req.body.idempotencyKey, "Idempotency key", 128, 16);
  if (!/^[A-Za-z0-9_-]+$/.test(idempotencyKey)) {
    throw new HttpError(400, "INVALID_INPUT", "Idempotency key has an invalid format");
  }
  const expectedTotalFils = integer(
    req.body.expectedTotalFils,
    "Expected total",
    0,
    Number.MAX_SAFE_INTEGER,
  );

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const input = {
      name,
      email: customerEmail,
      phone: customerPhone,
      address,
      expectedTotalFils,
      idempotencyKey,
    };
    const existing = await findExistingOrder(connection, idempotencyKey);
    if (existing) {
      await connection.commit();
      return replayOrReject(existing, input, res);
    }
    const cart = await getCart(req, res, connection, { lock: true });
    const [cartItems] = await connection.execute(
      "SELECT variant_id, quantity FROM cart_items WHERE cart_id = ? ORDER BY variant_id",
      [cart.id],
    );
    if (!cartItems.length)
      throw new HttpError(400, "CART_EMPTY", "Add a product before checkout");

    const [variants] = await connection.query(
      `SELECT v.id, v.variant_key, v.label, v.attributes, v.sku, v.price_fils, v.stock,
              v.is_active AS variant_active, p.is_active AS product_active, p.name AS product_name
       FROM product_variants v JOIN products p ON p.id = v.product_id
       WHERE v.id IN (${cartItems.map(() => "?").join(",")}) ORDER BY v.id FOR UPDATE`,
      cartItems.map((item) => item.variant_id),
    );
    const items = cartItems.map((item) => ({
      ...variants.find((variant) => variant.id === item.variant_id),
      quantity: item.quantity,
    }));
    if (
      items.some(
        (item) => !item.id || !item.variant_active || !item.product_active,
      )
    ) {
      throw new HttpError(
        409,
        "ITEM_UNAVAILABLE",
        "A product is no longer available",
      );
    }
    const totalFils = items.reduce(
      (sum, item) => sum + item.price_fils * item.quantity,
      0,
    );
    if (!Number.isSafeInteger(totalFils))
      throw new HttpError(400, "INVALID_TOTAL", "Cart total is too large");
    if (expectedTotalFils !== totalFils) {
      throw new HttpError(
        409,
        "PRICE_CHANGED",
        "Prices changed. Review your cart before checkout",
      );
    }
    if (items.some((item) => item.stock < item.quantity)) {
      throw new HttpError(
        409,
        "INSUFFICIENT_STOCK",
        "A product has insufficient stock",
      );
    }

    for (const item of items) {
      const [updated] = await connection.execute(
        "UPDATE product_variants SET stock = stock - ? WHERE id = ? AND stock >= ? AND is_active = 1",
        [item.quantity, item.id, item.quantity],
      );
      if (!updated.affectedRows)
        throw new HttpError(
          409,
          "INSUFFICIENT_STOCK",
          "A product has insufficient stock",
        );
    }

    const confirmationToken = makeConfirmationToken(idempotencyKey);
    const [order] = await connection.execute(
      `INSERT INTO orders (cart_id, customer_name, customer_email, customer_phone, customer_address,
                           total_fils, idempotency_key,
                           confirmation_token_hash, confirmation_expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 24 HOUR))`,
      [
        cart.id,
        name,
        customerEmail,
        customerPhone,
        address,
        totalFils,
        idempotencyKey,
        hashToken(confirmationToken),
      ],
    );
    for (const item of items) {
      await connection.execute(
        `INSERT INTO order_items (order_id, variant_id, product_name, variant_key, variant_label,
                                  variant_attributes, sku, unit_price_fils, quantity)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          order.insertId,
          item.id,
          item.product_name,
          item.variant_key,
          item.label,
          item.attributes == null ? null : JSON.stringify(item.attributes),
          item.sku,
          item.price_fils,
          item.quantity,
        ],
      );
    }
    await connection.execute(
      "INSERT INTO order_events (order_id, event_type, message) VALUES (?, 'placed', 'Order placed')",
      [order.insertId],
    );
    await connection.execute(
      "UPDATE carts SET status = 'checked_out' WHERE id = ? AND status = 'active'",
      [cart.id],
    );
    await connection.execute("DELETE FROM cart_items WHERE cart_id = ?", [
      cart.id,
    ]);
    await connection.commit();
    res
      .status(201)
      .json({ orderId: order.insertId, confirmationToken, totalFils });
  } catch (error) {
    await connection.rollback();
    if (error.code === "ER_DUP_ENTRY" && /idempotency/i.test(error.sqlMessage || "")) {
      const existing = await findExistingOrder(pool, idempotencyKey);
      if (existing) {
        return replayOrReject(
          existing,
          {
            name,
            email: customerEmail,
            phone: customerPhone,
            address,
            expectedTotalFils,
            idempotencyKey,
          },
          res,
        );
      }
    }
    throw error;
  } finally {
    connection.release();
  }
});
