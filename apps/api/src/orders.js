import { Router } from "express";
import { pool } from "./db.js";
import { hashToken } from "./auth.js";
import { HttpError, id, object, string, webUrl } from "./validation.js";

export const ordersRouter = Router();
export const adminOrders = Router();
ordersRouter.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

async function orderItems(orderId) {
  const [items] = await pool.execute(
    `SELECT product_name, variant_key, variant_label, variant_attributes, sku, unit_price_fils, quantity
     FROM order_items WHERE order_id = ? ORDER BY id`,
    [orderId],
  );
  return items.map((item) => ({
    productName: item.product_name,
    variantKey: item.variant_key,
    variantLabel: item.variant_label,
    attributes: item.variant_attributes,
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

function orderResponse(row, items) {
  return {
    id: row.id,
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

ordersRouter.get("/:id", async (req, res) => {
  const token = req.get("X-Order-Token");
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new HttpError(404, "NOT_FOUND", "Order confirmation unavailable");
  }
  const [orders] = await pool.execute(
    `SELECT id, customer_name, customer_email, customer_phone, customer_address, currency, total_fils,
            status, status_updated_at, carrier, tracking_number, tracking_url, refund_status, created_at
     FROM orders WHERE id = ? AND confirmation_token_hash = ? AND confirmation_expires_at > UTC_TIMESTAMP(6)`,
    [id(req.params.id), hashToken(token)],
  );
  if (!orders.length)
    throw new HttpError(404, "NOT_FOUND", "Order confirmation unavailable");
  res.json({
    order: {
      ...orderResponse(orders[0], await orderItems(orders[0].id)),
      events: await orderEvents(orders[0].id),
    },
  });
});

adminOrders.get("/", async (req, res) => {
  // shortcut: show the latest 100 orders; add pagination when the dashboard grows.
  const [rows] = await pool.execute(
    `SELECT id, customer_name, customer_email, total_fils, currency, status,
            refund_status, created_at FROM orders ORDER BY id DESC LIMIT 100`,
  );
  res.json({
    orders: rows.map((row) => ({
      id: row.id,
      name: row.customer_name,
      email: row.customer_email,
      totalFils: row.total_fils,
      currency: row.currency,
      status: row.status,
      refundStatus: row.refund_status,
      createdAt: row.created_at,
    })),
  });
});

adminOrders.get("/:id", async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT id, customer_name, customer_email, customer_phone, customer_address, currency, total_fils,
            status, status_updated_at, carrier, tracking_number, tracking_url,
            refund_status, refund_note, refund_updated_at, created_at
     FROM orders WHERE id = ?`,
    [id(req.params.id)],
  );
  if (!rows.length) throw new HttpError(404, "NOT_FOUND", "Order not found");
  res.json({
    order: {
      ...orderResponse(rows[0], await orderItems(rows[0].id)),
      refundNote: rows[0].refund_note,
      refundUpdatedAt: rows[0].refund_updated_at,
      events: await orderEvents(rows[0].id),
    },
  });
});

adminOrders.patch("/:id/status", async (req, res) => {
  object(req.body);
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
  if (status === "shipped" && (!carrier || !trackingNumber)) {
    throw new HttpError(
      400,
      "TRACKING_REQUIRED",
      "Add a carrier and tracking number before marking this order as dispatched",
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
          ? ["processing", "cancelled"]
          : current === "processing"
            ? ["shipped", "cancelled"]
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
          "SELECT variant_id, quantity FROM order_items WHERE order_id = ? ORDER BY variant_id",
          [orderId],
        );
        for (const item of items) {
          await connection.execute(
            "UPDATE product_variants SET stock = stock + ? WHERE id = ?",
            [item.quantity, item.variant_id],
          );
        }
      }
      if (status === "shipped") {
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

adminOrders.post("/:id/refund", async (req, res) => {
  object(req.body);
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
  object(req.body);
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
