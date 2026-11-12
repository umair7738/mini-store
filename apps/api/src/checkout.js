import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { pool } from "./db.js";
import { getCart } from "./cart.js";
import { hashToken } from "./auth.js";
import { getCustomer } from "./customerAuth.js";
import { getGuestSession, setGuestCookie } from "./guestSessions.js";
import { HttpError, email, id, integer, object, phone, string } from "./validation.js";

export const checkoutRouter = Router();

function setting(name, fallback, min, max) {
  const value = process.env[name];
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return parsed;
}

function retentionDays() { return setting("IDEMPOTENCY_RETENTION_DAYS", 7, 1, 30); }
function leaseSeconds() { return setting("CHECKOUT_ATTEMPT_LEASE_SECONDS", 60, 10, 900); }
function cleanupBatchSize() { return setting("IDEMPOTENCY_CLEANUP_BATCH_SIZE", 100, 1, 1000); }
function sameBytes(left, right) {
  if (!left || !right) return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function immutableFingerprint(input, mode, buyNow) {
  return hashToken(JSON.stringify({
    mode,
    name: input.name,
    email: input.email,
    phone: input.phone,
    address: input.address,
    expectedTotalFils: input.expectedTotalFils,
    buyNow: mode === "buy_now" ? buyNow : null,
  }));
}

function snapshotItems(items) {
  return items
    .map((item) => ({ productId: Number(item.product_id), quantity: Number(item.quantity) }))
    .sort((a, b) => a.productId - b.productId);
}

function parseSnapshot(value) {
  return typeof value === "string" ? JSON.parse(value) : value;
}

function sameItems(left, right) {
  return JSON.stringify(snapshotItems(left)) === JSON.stringify(snapshotItems(right));
}

function sameLegacyRequest(order, input) {
  return order.customer_name === input.name
    && order.customer_email === input.email
    && order.customer_phone === input.phone
    && order.customer_address === input.address
    && order.total_fils === input.expectedTotalFils;
}

function errorMessage(code) {
  return {
    CART_ALREADY_CHECKED_OUT: "This cart has already been checked out",
    CART_CHANGED: "Your cart changed while checkout was in progress. Start checkout again",
    CART_EXPIRED: "This cart has expired. Start checkout again",
    CHECKOUT_IN_PROGRESS: "Checkout is already being processed. Try again shortly",
    IDEMPOTENCY_CONFLICT: "This idempotency key was already used with different checkout details",
    IDEMPOTENCY_EXPIRED: "This checkout attempt is no longer replayable. Start a new checkout",
    IDEMPOTENCY_LEGACY_RETRY_REQUIRED: "This older checkout cannot be safely replayed. Start checkout again",
    CHECKOUT_STATE_UNCERTAIN: "Checkout state is being reconciled. Try again shortly",
    PRICE_CHANGED: "Prices changed. Review your cart before submitting again",
    INSUFFICIENT_STOCK: "A product has insufficient stock",
    ITEM_UNAVAILABLE: "A product is no longer available",
  }[code] || "Checkout could not be completed";
}

const persistedFailureCodes = new Set([
  "CART_ALREADY_CHECKED_OUT",
  "CART_CHANGED",
  "CART_EXPIRED",
  "PRICE_CHANGED",
  "INSUFFICIENT_STOCK",
  "ITEM_UNAVAILABLE",
]);

async function findAttempt(db, key, lock = false) {
  const [rows] = await db.execute(
    `SELECT id, idempotency_key, mode, customer_id, guest_session_id, cart_id, order_id,
            immutable_fingerprint, items_snapshot, status, claim_hash, lease_until, error_code
     FROM checkout_idempotency_keys
     WHERE idempotency_key = ?${lock ? " FOR UPDATE" : ""}`,
    [key],
  );
  return rows[0];
}

async function findOrder(db, attempt) {
  const [rows] = await db.execute(
    `SELECT id, public_id, customer_id, customer_name, customer_email, customer_phone,
            customer_address, total_fils
     FROM orders
     WHERE ${attempt.order_id ? "id = ?" : "idempotency_key = ?"}`,
    [attempt.order_id || attempt.idempotency_key],
  );
  return rows[0];
}

async function findCartOrder(db, cartId) {
  if (!cartId) return null;
  const [rows] = await db.execute("SELECT id, public_id, customer_id, customer_name, customer_email, customer_phone, customer_address, total_fils FROM orders WHERE cart_id = ?", [cartId]);
  return rows[0];
}

async function orderBelongsToPrincipal(db, order, customer, guest) {
  if (customer) return customer.id === order.customer_id;
  if (!guest) return false;
  const [rows] = await db.execute(
    "SELECT 1 FROM guest_session_orders WHERE guest_session_id = ? AND order_id = ?",
    [guest.id, order.id],
  );
  return rows.length > 0;
}

function principalMatches(attempt, customer, guest) {
  if (attempt.customer_id != null) return customer?.id === attempt.customer_id;
  if (attempt.guest_session_id != null) return guest?.id === attempt.guest_session_id;
  return false;
}

export function validateAttemptPrincipal({ customerId, guestSessionId, status = "in_progress" }) {
  if (status === "legacy") return;
  const customer = customerId == null ? null : customerId;
  const guest = guestSessionId == null ? null : guestSessionId;
  const validId = (value) => value == null || (Number.isSafeInteger(value) && value > 0);
  if (!validId(customer) || !validId(guest) || (customer == null) === (guest == null)) {
    throw new HttpError(500, "INVALID_IDEMPOTENCY_PRINCIPAL", "Checkout principal is invalid");
  }
}

function attemptMatchesInput(attempt, input, mode, buyNow) {
  if (attempt.mode !== mode || !sameBytes(attempt.immutable_fingerprint, immutableFingerprint(input, mode, buyNow))) return false;
  if (mode !== "buy_now") return true;
  const saved = parseSnapshot(attempt.items_snapshot);
  return saved?.length === 1
    && saved[0].productId === buyNow.productId
    && saved[0].quantity === buyNow.quantity;
}

function replayResponse(order, res) {
  if (!order) throw new HttpError(500, "CHECKOUT_STATE_UNCERTAIN", errorMessage("CHECKOUT_STATE_UNCERTAIN"));
  return res.status(200).json({
    orderId: order.id,
    orderNumber: `DM-${String(order.id).padStart(8, "0")}`,
    publicId: order.public_id,
    totalFils: order.total_fils,
    replayed: true,
  });
}

async function cleanupAttempts(db) {
  const batch = cleanupBatchSize();
  await db.execute(
    `DELETE FROM checkout_idempotency_keys
     WHERE expires_at <= UTC_TIMESTAMP(6)
       AND status IN ('completed', 'failed', 'legacy')
     ORDER BY expires_at, id
     LIMIT ${batch}`,
  );
  await db.execute(
    `DELETE FROM checkout_idempotency_keys
     WHERE expires_at <= UTC_TIMESTAMP(6)
       AND status IN ('in_progress', 'uncertain')
       AND (lease_until IS NULL OR lease_until <= UTC_TIMESTAMP(6))
       AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.idempotency_key = checkout_idempotency_keys.idempotency_key)
     ORDER BY expires_at, id
     LIMIT ${batch}`,
  );
}

async function reserveAttempt(req, res, input, mode, buyNow) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await cleanupAttempts(connection);
    const customer = await getCustomer(req, connection);
    let guest = customer ? null : await getGuestSession(req, connection, false);
    const attempt = await findAttempt(connection, input.idempotencyKey, true);

    if (attempt) {
      if (!principalMatches(attempt, customer, guest)) throw new HttpError(409, "IDEMPOTENCY_CONFLICT", errorMessage("IDEMPOTENCY_CONFLICT"));
      const order = await findOrder(connection, attempt);
      if (attempt.status === "legacy") {
        if (!order || !sameLegacyRequest(order, input)) throw new HttpError(409, "IDEMPOTENCY_LEGACY_RETRY_REQUIRED", errorMessage("IDEMPOTENCY_LEGACY_RETRY_REQUIRED"));
        await connection.commit();
        return { replay: order };
      }
      if (!attemptMatchesInput(attempt, input, mode, buyNow)) throw new HttpError(409, "IDEMPOTENCY_CONFLICT", errorMessage("IDEMPOTENCY_CONFLICT"));
      if (order) {
        await connection.execute("UPDATE checkout_idempotency_keys SET status = 'completed', order_id = ?, claim_hash = NULL, lease_until = NULL WHERE id = ?", [order.id, attempt.id]);
        await connection.commit();
        return { replay: order };
      }
      if (attempt.status === "completed") {
        if (!order) {
          await connection.execute(`UPDATE checkout_idempotency_keys
            SET status = 'uncertain', claim_hash = NULL, lease_until = DATE_ADD(UTC_TIMESTAMP(6), INTERVAL ${leaseSeconds()} SECOND)
            WHERE id = ?`, [attempt.id]);
          await connection.commit();
          throw new HttpError(409, "CHECKOUT_STATE_UNCERTAIN", errorMessage("CHECKOUT_STATE_UNCERTAIN"));
        }
        await connection.commit();
        return { replay: order };
      }
      if (attempt.status === "failed") throw new HttpError(409, attempt.error_code || "CHECKOUT_FAILED", errorMessage(attempt.error_code));
      if (attempt.status === "processing") throw new HttpError(409, "CHECKOUT_STATE_UNCERTAIN", errorMessage("CHECKOUT_STATE_UNCERTAIN"));
      if (attempt.lease_until && new Date(attempt.lease_until).getTime() > Date.now()) throw new HttpError(409, "CHECKOUT_IN_PROGRESS", errorMessage("CHECKOUT_IN_PROGRESS"));
      const existingCartOrder = await findCartOrder(connection, attempt.cart_id);
      if (existingCartOrder) {
        await connection.execute("UPDATE checkout_idempotency_keys SET status = 'failed', error_code = 'CART_ALREADY_CHECKED_OUT', claim_hash = NULL, lease_until = NULL WHERE id = ?", [attempt.id]);
        await connection.commit();
        throw new HttpError(409, "CART_ALREADY_CHECKED_OUT", errorMessage("CART_ALREADY_CHECKED_OUT"));
      }
      const claimToken = randomBytes(32).toString("base64url");
      await connection.execute(
        `UPDATE checkout_idempotency_keys
         SET status = 'in_progress', claim_hash = ?, lease_until = DATE_ADD(UTC_TIMESTAMP(6), INTERVAL ${leaseSeconds()} SECOND)
         WHERE id = ?`,
        [hashToken(claimToken), attempt.id],
      );
      await connection.commit();
      return { attempt, claimToken, customer, guest };
    }

    const expiredOrder = await findOrder(connection, { order_id: null, idempotency_key: input.idempotencyKey });
    if (expiredOrder) {
      if (!await orderBelongsToPrincipal(connection, expiredOrder, customer, guest)) {
        throw new HttpError(409, "IDEMPOTENCY_CONFLICT", errorMessage("IDEMPOTENCY_CONFLICT"));
      }
      throw new HttpError(409, "IDEMPOTENCY_EXPIRED", errorMessage("IDEMPOTENCY_EXPIRED"));
    }

    let cart = null;
    let cartItems;
    if (mode === "buy_now") {
      cartItems = [{ product_id: buyNow.productId, quantity: buyNow.quantity }];
    } else {
      try {
        cart = await getCart(req, res, connection, { lock: true });
      } catch (error) {
        if (error.code === "CART_CLOSED" && req.cookies?.mini_cart) {
          const [closedCarts] = await connection.execute(
            "SELECT id, status FROM carts WHERE token_hash = ? FOR UPDATE",
            [hashToken(req.cookies.mini_cart)],
          );
          const closedCart = closedCarts[0];
          if (closedCart?.status === "checked_out") {
            throw new HttpError(409, "CART_ALREADY_CHECKED_OUT", errorMessage("CART_ALREADY_CHECKED_OUT"));
          }
          if (closedCart?.status === "expired") throw new HttpError(409, "CART_EXPIRED", errorMessage("CART_EXPIRED"));
        }
        throw error;
      }
      [cartItems] = await connection.execute("SELECT product_id, quantity FROM cart_items WHERE cart_id = ? ORDER BY product_id", [cart.id]);
    }
    if (!cartItems.length) throw new HttpError(400, "CART_EMPTY", "Add a product before checkout");
    if (cartItems.some((item) => item.quantity > 20)) throw new HttpError(409, "QUANTITY_LIMIT", "Update cart quantities to 20 or less before checkout");
    if (!customer) guest = await getGuestSession(req, connection, true);
    validateAttemptPrincipal({ customerId: customer?.id, guestSessionId: guest?.id });
    const claimToken = randomBytes(32).toString("base64url");
    const [created] = await connection.execute(
      `INSERT INTO checkout_idempotency_keys
         (idempotency_key, mode, customer_id, guest_session_id, cart_id, immutable_fingerprint,
          items_snapshot, status, claim_hash, lease_until, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'in_progress', ?, DATE_ADD(UTC_TIMESTAMP(6), INTERVAL ${leaseSeconds()} SECOND), DATE_ADD(UTC_TIMESTAMP(6), INTERVAL ${retentionDays()} DAY))`,
      [input.idempotencyKey, mode, customer?.id || null, guest?.id || null, cart?.id || null, immutableFingerprint(input, mode, buyNow), JSON.stringify(snapshotItems(cartItems)), hashToken(claimToken)],
    );
    await connection.commit();
    if (guest?.isNew) setGuestCookie(res, guest.token);
    return { attempt: { id: created.insertId, idempotency_key: input.idempotencyKey, mode, cart_id: cart?.id || null, guest_session_id: guest?.id || null, customer_id: customer?.id || null }, claimToken, customer, guest };
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

async function markFailed(attemptId, code) {
  await pool.execute(
    `UPDATE checkout_idempotency_keys
     SET status = 'failed', error_code = ?, claim_hash = NULL, lease_until = NULL
     WHERE id = ? AND status IN ('in_progress', 'processing', 'uncertain')`,
    [code, attemptId],
  );
}

async function executeAttempt(req, res, input, prepared) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    if (!prepared?.attempt) throw new HttpError(409, "CHECKOUT_STATE_UNCERTAIN", errorMessage("CHECKOUT_STATE_UNCERTAIN"));
    const [attemptRows] = await connection.execute("SELECT * FROM checkout_idempotency_keys WHERE id = ? FOR UPDATE", [prepared.attempt.id]);
    const attempt = attemptRows[0];
    if (!attempt || !sameBytes(attempt.claim_hash, hashToken(prepared.claimToken))) throw new HttpError(409, "CHECKOUT_IN_PROGRESS", errorMessage("CHECKOUT_IN_PROGRESS"));
    const customer = await getCustomer(req, connection);
    const currentGuest = customer ? null : await getGuestSession(req, connection, false);
    const guest = currentGuest || (prepared.guest?.isNew ? prepared.guest : null);
    if (!principalMatches(attempt, customer, guest)) throw new HttpError(409, "IDEMPOTENCY_CONFLICT", errorMessage("IDEMPOTENCY_CONFLICT"));
    await connection.execute("UPDATE checkout_idempotency_keys SET status = 'processing', claim_hash = NULL, lease_until = NULL WHERE id = ?", [attempt.id]);

    const items = parseSnapshot(attempt.items_snapshot).map((item) => ({ product_id: item.productId, quantity: item.quantity }));
    let cart = attempt.cart_id ? { id: attempt.cart_id } : null;
    if (attempt.mode === "cart") {
      const [carts] = await connection.execute("SELECT id, status, expires_at FROM carts WHERE id = ? FOR UPDATE", [attempt.cart_id]);
      if (!carts.length || carts[0].status !== "active") {
        const existing = await findOrder(connection, attempt);
        if (existing) {
          await connection.execute("UPDATE checkout_idempotency_keys SET status = 'completed', order_id = ? WHERE id = ?", [existing.id, attempt.id]);
          await connection.commit();
          return replayResponse(existing, res);
        }
        const code = !carts.length ? "CART_CHANGED" : carts[0].status === "checked_out" ? "CART_ALREADY_CHECKED_OUT" : "CART_EXPIRED";
        throw new HttpError(409, code, errorMessage(code));
      }
      if (new Date(carts[0].expires_at).getTime() <= Date.now()) throw new HttpError(409, "CART_EXPIRED", errorMessage("CART_EXPIRED"));
      const [currentItems] = await connection.execute("SELECT product_id, quantity FROM cart_items WHERE cart_id = ? ORDER BY product_id", [attempt.cart_id]);
      if (!sameItems(currentItems, items)) throw new HttpError(409, "CART_CHANGED", errorMessage("CART_CHANGED"));
    } else {
      const cartToken = randomBytes(32).toString("base64url");
      const [createdCart] = await connection.execute("INSERT INTO carts (token_hash, status, expires_at) VALUES (?, 'checked_out', DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 30 DAY))", [hashToken(cartToken)]);
      cart = { id: createdCart.insertId };
      await connection.execute("UPDATE checkout_idempotency_keys SET cart_id = ? WHERE id = ?", [cart.id, attempt.id]);
    }

    const productIds = items.map((item) => item.product_id);
    const [products] = await connection.execute(`SELECT id, name AS product_name, sku, price_fils, stock, is_active FROM products WHERE id IN (${productIds.map(() => "?").join(",")}) ORDER BY id FOR UPDATE`, productIds);
    const orderItems = items.map((item) => ({ ...products.find((product) => product.id === item.product_id), quantity: item.quantity }));
    if (orderItems.some((item) => !item.id || !item.is_active)) throw new HttpError(409, "ITEM_UNAVAILABLE", errorMessage("ITEM_UNAVAILABLE"));
    const totalFils = orderItems.reduce((sum, item) => sum + item.price_fils * item.quantity, 0);
    if (!Number.isSafeInteger(totalFils)) throw new HttpError(400, "INVALID_TOTAL", "Cart total is too large");
    if (input.expectedTotalFils !== totalFils) throw new HttpError(409, "PRICE_CHANGED", errorMessage("PRICE_CHANGED"));
    if (orderItems.some((item) => item.stock < item.quantity)) throw new HttpError(409, "INSUFFICIENT_STOCK", errorMessage("INSUFFICIENT_STOCK"));
    for (const item of orderItems) {
      const [updated] = await connection.execute("UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ? AND is_active = 1", [item.quantity, item.id, item.quantity]);
      if (!updated.affectedRows) throw new HttpError(409, "INSUFFICIENT_STOCK", errorMessage("INSUFFICIENT_STOCK"));
    }

    const publicId = randomUUID();
    const [order] = await connection.execute(
      `INSERT INTO orders (public_id, customer_id, cart_id, customer_name, customer_email, customer_phone, customer_address,
                           total_fils, idempotency_key, confirmation_token_hash, confirmation_expires_at, payment_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 24 HOUR), 'unpaid')`,
      [publicId, customer?.id || null, cart.id, input.name, input.email, input.phone, input.address, totalFils, input.idempotencyKey, hashToken(randomBytes(32).toString("base64url"))],
    );
    for (const item of orderItems) await connection.execute("INSERT INTO order_items (order_id, product_id, product_name, sku, unit_price_fils, quantity) VALUES (?, ?, ?, ?, ?, ?)", [order.insertId, item.id, item.product_name, item.sku, item.price_fils, item.quantity]);
    if (guest) await connection.execute("INSERT INTO guest_session_orders (guest_session_id, order_id) VALUES (?, ?)", [guest.id, order.insertId]);
    await connection.execute("INSERT INTO order_events (order_id, event_type, message) VALUES (?, 'placed', 'Order placed')", [order.insertId]);
    await connection.execute("UPDATE carts SET status = 'checked_out' WHERE id = ? AND status = 'active'", [cart.id]);
    if (attempt.mode === "cart") await connection.execute("DELETE FROM cart_items WHERE cart_id = ?", [cart.id]);
    await connection.execute("UPDATE checkout_idempotency_keys SET status = 'completed', order_id = ?, claim_hash = NULL, lease_until = NULL WHERE id = ?", [order.insertId, attempt.id]);
    await connection.commit();
    res.status(201).json({ orderId: order.insertId, orderNumber: `DM-${String(order.insertId).padStart(8, "0")}`, publicId, totalFils });
  } catch (error) {
    await connection.rollback().catch(() => {});
    if (error.code === "ER_LOCK_DEADLOCK" || error.code === "ER_LOCK_WAIT_TIMEOUT") {
      const committed = await findOrder(pool, { order_id: null, idempotency_key: input.idempotencyKey });
      if (committed) {
        await pool.execute("UPDATE checkout_idempotency_keys SET status = 'completed', order_id = ?, claim_hash = NULL, lease_until = NULL WHERE id = ?", [committed.id, prepared.attempt.id]);
        return replayResponse(committed, res);
      }
      const cartOrder = await findCartOrder(pool, prepared.attempt.cart_id);
      error = cartOrder
        ? new HttpError(409, "CART_ALREADY_CHECKED_OUT", errorMessage("CART_ALREADY_CHECKED_OUT"))
        : new HttpError(409, "CHECKOUT_IN_PROGRESS", errorMessage("CHECKOUT_IN_PROGRESS"));
    }
    if (error.code === "ER_DUP_ENTRY" && /cart_id/i.test(error.sqlMessage || "")) error = new HttpError(409, "CART_ALREADY_CHECKED_OUT", errorMessage("CART_ALREADY_CHECKED_OUT"));
    if (error.code === "ER_DUP_ENTRY" && /idempotency_key/i.test(error.sqlMessage || "")) error = new HttpError(409, "IDEMPOTENCY_EXPIRED", errorMessage("IDEMPOTENCY_EXPIRED"));
    if (error instanceof HttpError && persistedFailureCodes.has(error.code)) await markFailed(prepared.attempt.id, error.code).catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

checkoutRouter.post("/", async (req, res) => {
  object(req.body, ["name", "address", "email", "phone", "idempotencyKey", "expectedTotalFils", "buyNow"]);
  const name = string(req.body.name, "Name");
  const address = string(req.body.address, "Address", 500, 10);
  const customerEmail = email(req.body.email);
  const customerPhone = phone(req.body.phone);
  const idempotencyKey = string(req.body.idempotencyKey, "Idempotency key", 128, 16);
  if (!/^[A-Za-z0-9_-]+$/.test(idempotencyKey)) throw new HttpError(400, "INVALID_INPUT", "Idempotency key has an invalid format");
  const expectedTotalFils = integer(req.body.expectedTotalFils, "Expected total", 0, Number.MAX_SAFE_INTEGER);
  const buyNow = req.body.buyNow;
  if (buyNow !== undefined) object(buyNow, ["productId", "quantity"]);
  const mode = buyNow === undefined ? "cart" : "buy_now";
  const normalizedBuyNow = buyNow === undefined ? null : { productId: id(buyNow.productId), quantity: integer(buyNow.quantity, "Quantity", 1, 20) };
  const input = { name, email: customerEmail, phone: customerPhone, address, expectedTotalFils, idempotencyKey };
  const prepared = await reserveAttempt(req, res, input, mode, normalizedBuyNow);
  if (prepared.replay) return replayResponse(prepared.replay, res);
  return executeAttempt(req, res, input, prepared);
});
