import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { app } from "../src/server.js";
import { hashToken } from "../src/auth.js";
import { pool } from "../src/db.js";

test("dispatch details can be corrected once without changing status", async (t) => {
  const [database] = await pool.query("SELECT DATABASE() AS name");
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(database[0].name, process.env.DB_NAME);
  assert.notEqual(database[0].name, "mini_store_dev");
  const suffix = randomBytes(6).toString("hex");
  const password = randomBytes(16).toString("base64url");
  const salt = randomBytes(16).toString("hex");
  const guestToken = randomBytes(32).toString("base64url");
  const [admin] = await pool.execute("INSERT INTO admin_users (email, password_hash) VALUES (?, ?)", [`tracking-${suffix}@example.com`, `${salt}:${scryptSync(password, salt, 64).toString("hex")}`]);
  const [cart] = await pool.execute("INSERT INTO carts (token_hash, status, expires_at) VALUES (?, 'checked_out', DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 1 DAY))", [randomBytes(32)]);
  const [order] = await pool.execute(
    `INSERT INTO orders (public_id, cart_id, customer_name, customer_email, customer_address, total_fils, status, carrier, tracking_number, confirmation_token_hash, confirmation_expires_at)
     VALUES (?, ?, 'Tracking Test', ?, 'Dubai', 100, 'shipped', 'First carrier', 'FIRST123', ?, DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 1 DAY))`,
    [randomUUID(), cart.insertId, `tracking-${suffix}@example.com`, randomBytes(32)],
  );
  const [guest] = await pool.execute("INSERT INTO guest_sessions (token_hash, expires_at) VALUES (?, DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 1 DAY))", [hashToken(guestToken)]);
  await pool.execute("INSERT INTO guest_session_orders (guest_session_id, order_id) VALUES (?, ?)", [guest.insertId, order.insertId]);
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await pool.execute("DELETE FROM order_events WHERE order_id = ?", [order.insertId]);
    await pool.execute("DELETE FROM guest_session_orders WHERE order_id = ?", [order.insertId]);
    await pool.execute("DELETE FROM orders WHERE id = ?", [order.insertId]);
    await pool.execute("DELETE FROM guest_sessions WHERE id = ?", [guest.insertId]);
    await pool.execute("DELETE FROM carts WHERE id = ?", [cart.insertId]);
    await pool.execute("DELETE FROM admin_sessions WHERE admin_user_id = ?", [admin.insertId]);
    await pool.execute("DELETE FROM admin_users WHERE id = ?", [admin.insertId]);
    await pool.end();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(path, method = "GET", body, cookie, csrf) {
    const response = await fetch(base + path, {
      method,
      headers: {
        ...(method !== "GET" && { Origin: process.env.WEB_ORIGIN }),
        ...(body && { "Content-Type": "application/json" }),
        ...(cookie && { Cookie: cookie }),
        ...(csrf && { "X-CSRF-Token": csrf }),
      },
      ...(body && { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
  }
  const login = await call("/api/admin/login", "POST", { email: `tracking-${suffix}@example.com`, password });
  assert.equal(login.status, 200);
  const adminCall = (path, method = "GET", body) => call(path, method, body, login.cookie, login.data.csrfToken);
  const path = `/api/admin/orders/${order.insertId}/tracking`;
  const corrected = { carrier: "Correct carrier", trackingNumber: "CORRECT123", trackingUrl: "https://example.com/track/123" };
  assert.equal((await call(path, "PATCH", corrected)).status, 401);
  assert.equal((await adminCall(path, "PATCH", { ...corrected, carrier: "" })).status, 400);
  assert.equal((await adminCall(path, "PATCH", { ...corrected, trackingNumber: "" })).status, 400);
  assert.equal((await adminCall(path, "PATCH", { ...corrected, trackingUrl: "javascript:alert(1)" })).status, 400);
  assert.equal((await adminCall(path, "PATCH", corrected)).status, 200);
  const detail = (await adminCall(`/api/admin/orders/${order.insertId}`)).data.order;
  assert.equal(detail.status, "shipped");
  assert.equal(detail.carrier, corrected.carrier);
  assert.equal(detail.trackingNumber, corrected.trackingNumber);
  assert.equal(detail.events.at(-1).type, "tracking_corrected");
  assert.equal((await adminCall(path, "PATCH", corrected)).status, 200);
  assert.equal((await adminCall(`/api/admin/orders/${order.insertId}`)).data.order.events.length, detail.events.length);
  const customer = (await call(`/api/orders/DM-${String(order.insertId).padStart(8, "0")}`, "GET", null, `mini_guest=${guestToken}`)).data.order;
  assert.equal(customer.trackingUrl, corrected.trackingUrl);
  assert.equal(customer.trackingNumber, corrected.trackingNumber);
  assert.equal((await adminCall(`/api/admin/orders/${order.insertId}/status`, "PATCH", { status: "delivered", ...corrected })).status, 200);
  assert.equal((await adminCall(path, "PATCH", corrected)).status, 409);
});
