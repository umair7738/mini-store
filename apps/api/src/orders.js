import { randomBytes } from "node:crypto";
import { Router } from "express";
import { pool } from "./db.js";
import { hashToken } from "./auth.js";
import { decryptOrderReference } from "./orderReference.js";
import { getCustomer } from "./customerAuth.js";
import { forgetGuestSession, getGuestSession, setGuestCookie } from "./guestSessions.js";
import { HttpError, email, id, object, string, webUrl } from "./validation.js";
import { pagination } from "./pagination.js";
import { clientAddress, identifierHash, rateLimit } from "./rateLimit.js";

export const ordersRouter = Router();
export const adminOrders = Router();
ordersRouter.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

async function orderItems(orderId) {
  const [items] = await pool.execute(
    `SELECT product_name, sku, unit_price_fils, quantity
     FROM order_items WHERE order_id = ? ORDER BY id`,
    [orderId],
  );
  return items.map((item) => ({
    productName: item.product_name,
    sku: item.sku,
    unitPriceFils: item.unit_price_fils,
    quantity: item.quantity,
  }));
}

async function orderEvents(orderId) {
  const [events] = await pool.execute(
    "SELECT event_type, message, created_at FROM order_events WHERE order_id = ? ORDER BY id",
    [orderId],
  );
  return events.map((event) => ({
    type: event.event_type,
    message: event.message,
    createdAt: event.created_at,
  }));
}

function orderResponse(row, items, { internal = false } = {}) {
  return {
    orderNumber: `DM-${String(row.id).padStart(8, "0")}`,
    ...(internal ? { id: row.id } : {}),
    publicId: row.public_id,
    name: row.customer_name,
    email: row.customer_email,
    phone: row.customer_phone,
    address: row.customer_address,
    currency: row.currency,
    totalFils: row.total_fils,
    status: row.status,
    statusUpdatedAt: row.status_updated_at,
    carrier: row.carrier,
    trackingNumber: row.tracking_number,
    trackingUrl: row.tracking_url,
    refundStatus: row.refund_status,
    createdAt: row.created_at,
    items,
  };
}

function orderNumberId(value) {
  const match = /^DM-(\d{8,10})$/.exec(value);
  return match ? Number(match[1]) : null;
}

ordersRouter.get("/", async (req, res) => {
  res.set("Cache-Control", "no-store");
  const customer = await getCustomer(req);
  const guest = await getGuestSession(req);
  if (!customer && !guest) return res.json({ orders: [] });
  const [rows] = await pool.execute(
    `SELECT DISTINCT o.id, o.public_id, o.customer_name, o.customer_email, o.customer_phone, o.customer_address,
       o.currency, o.total_fils, o.status, o.status_updated_at, o.carrier, o.tracking_number, o.tracking_url,
       o.refund_status, o.created_at
     FROM orders o LEFT JOIN guest_session_orders gso ON gso.order_id = o.id
     WHERE o.customer_id = COALESCE(?, 0) OR gso.guest_session_id = COALESCE(?, 0)
     ORDER BY o.created_at DESC`,
    [customer?.id || null, guest?.id || null],
  );
  res.json({ orders: await Promise.all(rows.map(async (row) => ({
    orderNumber: `DM-${String(row.id).padStart(8, "0")}`,
    createdAt: row.created_at,
    status: row.status,
    totalFils: row.total_fils,
    currency: row.currency,
    productSummary: (await orderItems(row.id)).map((item) => `${item.productName} × ${item.quantity}`).join(", "),
  }))) });
});

ordersRouter.post("/forget-device", async (req, res) => {
  await forgetGuestSession(req, res);
  res.status(204).end();
});

ordersRouter.post(
  "/recover",
  rateLimit({ name: "recovery-ip", limitEnv: "RATE_LIMIT_RECOVERY_PER_15_MINUTES", fallbackLimit: 5, windowMs: 15 * 60 * 1000, key: (req) => [clientAddress(req)], code: "RATE_LIMITED", message: "Too many recovery requests. Try again later." }),
  rateLimit({ name: "recovery-email", limitEnv: "RATE_LIMIT_RECOVERY_PER_EMAIL_15_MINUTES", fallbackLimit: 3, windowMs: 15 * 60 * 1000, key: (req) => [clientAddress(req), identifierHash(req.body?.email)], code: "RATE_LIMITED", message: "Too many recovery requests. Try again later." }),
  async (req, res) => {
  object(req.body, ["email", "orderNumber"]);
  const address = email(req.body.email);
  const number = string(req.body.orderNumber, "Order number", 13);
  const dbId = orderNumberId(number);
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) throw new HttpError(503, "EMAIL_NOT_CONFIGURED", "Order recovery email is not configured. Current-device order access remains available.");
  await pool.execute("DELETE FROM order_recovery_tokens WHERE expires_at <= UTC_TIMESTAMP(6) OR used_at IS NOT NULL");
  let rows = [];
  if (dbId) [rows] = await pool.execute("SELECT id FROM orders WHERE id = ? AND customer_email = ?", [dbId, address]);
  if (rows.length) {
    const token = randomBytes(32).toString("base64url");
    await pool.execute("INSERT INTO order_recovery_tokens (token_hash, order_id, expires_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 15 MINUTE))", [hashToken(token), rows[0].id]);
    const link = `${process.env.WEB_ORIGIN}/orders/recover#${token}`;
    try {
      const mail = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [address], subject: "Verify your Danube Milano order", html: `<p>Use this secure link within 15 minutes to access your order:</p><p><a href="${link}">View your order</a></p>` }),
        signal: AbortSignal.timeout(8000),
      });
      if (!mail.ok) console.error("Order recovery email delivery failed", mail.status);
    } catch { console.error("Order recovery email delivery failed"); }
  }
  res.status(202).json({ message: "If the order details match, a verification link will be sent to the checkout email." });
  },
);

ordersRouter.post(
  "/recover/verify",
  rateLimit({ name: "recovery-verify", limitEnv: "RATE_LIMIT_RECOVERY_VERIFY_PER_15_MINUTES", fallbackLimit: 10, windowMs: 15 * 60 * 1000, key: (req) => [clientAddress(req)], code: "RATE_LIMITED", message: "Too many recovery attempts. Try again later." }),
  async (req, res) => {
  object(req.body, ["token"]);
  const token = string(req.body.token, "Verification token", 100);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new HttpError(400, "INVALID_TOKEN", "Verification link is invalid or expired");
  const connection = await pool.getConnection();
  let guest;
  let orderId;
  try {
    await connection.beginTransaction();
    const [tokens] = await connection.execute("SELECT t.order_id, o.customer_email FROM order_recovery_tokens t JOIN orders o ON o.id = t.order_id WHERE t.token_hash = ? AND t.used_at IS NULL AND t.expires_at > UTC_TIMESTAMP(6) FOR UPDATE", [hashToken(token)]);
    if (!tokens.length) throw new HttpError(400, "INVALID_TOKEN", "Verification link is invalid or expired");
    orderId = tokens[0].order_id;
    guest = await getGuestSession(req, connection, true);
    await connection.execute("UPDATE order_recovery_tokens SET used_at = UTC_TIMESTAMP(6) WHERE token_hash = ?", [hashToken(token)]);
    await connection.execute("INSERT IGNORE INTO guest_session_orders (guest_session_id, order_id) SELECT ?, id FROM orders WHERE customer_email = ?", [guest.id, tokens[0].customer_email]);
    await connection.execute("UPDATE orders o JOIN customers c ON c.email = o.customer_email SET o.customer_id = c.id WHERE o.customer_email = ? AND o.customer_id IS NULL", [tokens[0].customer_email]);
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
  if (guest?.isNew) setGuestCookie(res, guest.token);
  res.json({ message: "Order access verified", orderNumber: `DM-${String(orderId).padStart(8, "0")}` });
  },
);

ordersRouter.get("/:publicId", async (req, res) => {
  const orderRef = req.params.publicId;
  const customer = await getCustomer(req);
  const guest = await getGuestSession(req);
  if (!customer && !guest) throw new HttpError(404, "NOT_FOUND", "Order not found");
  const numberId = orderNumberId(orderRef);
  const encryptedPublicId = numberId ? null : decryptOrderReference(orderRef);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderRef) ? orderRef : encryptedPublicId;
  if (!numberId && !uuid) throw new HttpError(404, "NOT_FOUND", "Order not found");
  const [orders] = await pool.execute(
    `SELECT DISTINCT o.id, o.public_id, o.customer_name, o.customer_email, o.customer_phone, o.customer_address, o.currency, o.total_fils,
            o.status, o.status_updated_at, o.carrier, o.tracking_number, o.tracking_url, o.refund_status, o.created_at
     FROM orders o LEFT JOIN guest_session_orders gso ON gso.order_id = o.id
     WHERE ${numberId ? "o.id = ?" : "o.public_id = ?"} AND (o.customer_id = COALESCE(?, 0) OR gso.guest_session_id = COALESCE(?, 0))`,
    [numberId || uuid, customer?.id || null, guest?.id || null],
  );
  if (!orders.length)
    throw new HttpError(404, "NOT_FOUND", "Order not found");
  res.json({
    order: {
      ...orderResponse(orders[0], await orderItems(orders[0].id)),
      events: await orderEvents(orders[0].id),
    },
  });
});

adminOrders.get("/", async (req, res) => {
  let where = "";
  let params = [];
  let pageInfo = {};
  let limit = "LIMIT 100";
  if (req.query.page !== undefined) {
    const { page, search, size } = pagination(req.query);
    const status = req.query.status || "all";
    if (!["all", "placed", "processing", "shipped", "delivered", "completed", "cancelled", "refund"].includes(status)) throw new HttpError(400, "INVALID_INPUT", "Invalid order status");
    where = `WHERE (LOCATE(?, CONCAT('DM-', LPAD(id, GREATEST(8, LENGTH(id)), '0'))) > 0 OR LOCATE(?, customer_name) > 0 OR LOCATE(?, customer_email) > 0)`;
    params = [search, search, search];
    if (status === "refund") where += " AND refund_status = 'pending'";
    else if (status !== "all") { where += " AND status = ?"; params.push(status); }
    const [counts] = await pool.execute(`SELECT COUNT(*) AS total FROM orders ${where}`, params);
    const total = counts[0].total;
    const currentPage = Math.min(page, Math.max(1, Math.ceil(total / size)));
    pageInfo = { total, page: currentPage, pageSize: size };
    limit = "LIMIT ? OFFSET ?";
    params = [...params, size, (currentPage - 1) * size];
  }
  const [rows] = await pool.execute(
    `SELECT id, customer_name, customer_email, total_fils, currency, status,
            refund_status, payment_status, created_at FROM orders ${where} ORDER BY id DESC ${limit}`,
    params,
  );
  res.json({
    ...pageInfo, orders: rows.map((row) => ({
      id: row.id,
      orderNumber: `DM-${String(row.id).padStart(8, "0")}`,
      name: row.customer_name,
      email: row.customer_email,
      totalFils: row.total_fils,
      currency: row.currency,
      status: row.status,
      refundStatus: row.refund_status,
      paymentStatus: row.payment_status,
      createdAt: row.created_at,
    })),
  });
});

adminOrders.get("/:id", async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT id, public_id, customer_name, customer_email, customer_phone, customer_address, currency, total_fils,
            status, status_updated_at, carrier, tracking_number, tracking_url,
            refund_status, refund_note, refund_updated_at, payment_status, created_at
     FROM orders WHERE id = ?`,
    [id(req.params.id)],
  );
  if (!rows.length) throw new HttpError(404, "NOT_FOUND", "Order not found");
  res.json({
    order: {
      ...orderResponse(rows[0], await orderItems(rows[0].id), { internal: true }),
      paymentStatus: rows[0].payment_status,
      refundNote: rows[0].refund_note,
      refundUpdatedAt: rows[0].refund_updated_at,
      events: await orderEvents(rows[0].id),
    },
  });
});

adminOrders.patch("/:id/status", async (req, res) => {
  object(req.body, ["status", "carrier", "trackingNumber", "trackingUrl"]);
  const status = req.body.status;
  if (!["processing", "shipped", "delivered", "cancelled"].includes(status)) {
    throw new HttpError(400, "INVALID_INPUT", "Invalid order status");
  }
  const carrier = req.body.carrier == null ? null : string(req.body.carrier, "Carrier", 80);
  const trackingNumber = req.body.trackingNumber == null
    ? null
    : string(req.body.trackingNumber, "Tracking number", 120);
  const trackingUrl = req.body.trackingUrl == null
    ? null
    : webUrl(req.body.trackingUrl, "Tracking link");
  if (["shipped", "delivered"].includes(status) && (!carrier || !trackingNumber)) {
    throw new HttpError(
      400,
      "TRACKING_REQUIRED",
      "Add a carrier and tracking number before marking this order as dispatched or delivered",
    );
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const orderId = id(req.params.id);
    const [rows] = await connection.execute(
      "SELECT status FROM orders WHERE id = ? FOR UPDATE",
      [orderId],
    );
    if (!rows.length) throw new HttpError(404, "NOT_FOUND", "Order not found");
    const current = rows[0].status;
    if (current !== status) {
      const allowed =
        current === "placed"
          ? ["processing", "shipped", "delivered", "cancelled"]
          : current === "processing"
            ? ["shipped", "delivered", "cancelled"]
            : current === "shipped"
              ? ["delivered"]
            : [];
      if (!allowed.includes(status)) {
        throw new HttpError(
          409,
          "INVALID_STATUS",
          "This status change is not allowed",
        );
      }
      if (status === "cancelled") {
        const [items] = await connection.execute(
          "SELECT product_id, quantity FROM order_items WHERE order_id = ? ORDER BY product_id",
          [orderId],
        );
        for (const item of items) {
          await connection.execute(
            "UPDATE products SET stock = stock + ? WHERE id = ?",
            [item.quantity, item.product_id],
          );
        }
      }
      if (["shipped", "delivered"].includes(status)) {
        await connection.execute(
          `UPDATE orders SET status = ?, status_updated_at = UTC_TIMESTAMP(6),
           carrier = ?, tracking_number = ?, tracking_url = ? WHERE id = ?`,
          [status, carrier, trackingNumber, trackingUrl, orderId],
        );
      } else {
        await connection.execute(
          "UPDATE orders SET status = ?, status_updated_at = UTC_TIMESTAMP(6) WHERE id = ?",
          [status, orderId],
        );
      }
      const message =
        status === "processing"
          ? "Order is being prepared"
          : status === "shipped"
            ? `Order dispatched with ${carrier}`
            : status === "delivered"
              ? "Order delivered"
              : "Order cancelled and stock returned";
      await connection.execute(
        "INSERT INTO order_events (order_id, event_type, message) VALUES (?, ?, ?)",
        [orderId, status, message],
      );
    }
    await connection.commit();
    res.json({ status });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
});

adminOrders.patch("/:id/payment-status", async (req, res) => {
  object(req.body, ["status"]);
  if (!["paid", "unpaid"].includes(req.body.status)) {
    throw new HttpError(400, "INVALID_INPUT", "Invalid payment status");
  }
  const [result] = await pool.execute(
    "UPDATE orders SET payment_status = ? WHERE id = ?",
    [req.body.status, id(req.params.id)],
  );
  if (!result.affectedRows) throw new HttpError(404, "NOT_FOUND", "Order not found");
  res.json({ paymentStatus: req.body.status });
});

adminOrders.post("/:id/refund", async (req, res) => {
  object(req.body, ["note"]);
  const note = string(req.body.note, "Refund note", 500, 10);
  // shortcut: full-order manual refund records only; add amounts with payment processing.
  const [result] = await pool.execute(
    `UPDATE orders SET refund_status = 'pending', refund_note = ?, refund_updated_at = UTC_TIMESTAMP(6)
     WHERE id = ? AND status IN ('delivered', 'completed', 'cancelled') AND refund_status = 'none'`,
    [note, id(req.params.id)],
  );
  if (!result.affectedRows) {
    const [rows] = await pool.execute("SELECT id FROM orders WHERE id = ?", [
      id(req.params.id),
    ]);
    throw new HttpError(
      rows.length ? 409 : 404,
      rows.length ? "INVALID_REFUND" : "NOT_FOUND",
      rows.length
        ? "Refund cannot be requested for this order"
        : "Order not found",
    );
  }
  res.status(201).json({ refundStatus: "pending" });
});

adminOrders.patch("/:id/refund", async (req, res) => {
  object(req.body, ["status"]);
  if (req.body.status !== "completed") {
    throw new HttpError(
      400,
      "INVALID_INPUT",
      "Refund status must be completed",
    );
  }
  const [result] = await pool.execute(
    `UPDATE orders SET refund_status = 'completed', refund_updated_at = UTC_TIMESTAMP(6)
     WHERE id = ? AND refund_status = 'pending'`,
    [id(req.params.id)],
  );
  if (!result.affectedRows) {
    const [rows] = await pool.execute("SELECT id FROM orders WHERE id = ?", [
      id(req.params.id),
    ]);
    throw new HttpError(
      rows.length ? 409 : 404,
      rows.length ? "INVALID_REFUND" : "NOT_FOUND",
      rows.length ? "No pending refund for this order" : "Order not found",
    );
  }
  res.json({ refundStatus: "completed" });
});
