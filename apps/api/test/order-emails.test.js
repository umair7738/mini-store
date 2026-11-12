import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";

process.env.CSRF_SECRET = process.env.CSRF_SECRET || "test-csrf-secret-test-csrf-secret-32";
process.env.WEB_ORIGIN = process.env.WEB_ORIGIN || "http://localhost:3000";
process.env.BREVO_API_KEY = "test-brevo-key";
process.env.EMAIL_FROM = "test@example.com";
process.env.EMAIL_FROM_NAME = "Test Sender";
process.env.RATE_LIMIT_CHECKOUT_PER_MINUTE = "1000";
process.env.RATE_LIMIT_CHECKOUT_SESSION_PER_MINUTE = "1000";
process.env.RATE_LIMIT_CUSTOMER_AUTH_PER_MINUTE = "1000";
process.env.RATE_LIMIT_CUSTOMER_AUTH_PER_ACCOUNT_PER_MINUTE = "1000";
process.env.RATE_LIMIT_ADMIN_MUTATIONS_PER_MINUTE = "1000";
process.env.RATE_LIMIT_ADMIN_LOGIN_PER_MINUTE = "1000";
process.env.RATE_LIMIT_ADMIN_LOGIN_PER_ACCOUNT_PER_MINUTE = "1000";
process.env.RATE_LIMIT_CART_PER_MINUTE = "1000";
process.env.RATE_LIMIT_PRIVATE_READS_PER_MINUTE = "1000";
process.env.RATE_LIMIT_ORDER_ACTIONS_PER_MINUTE = "1000";
process.env.RATE_LIMIT_CUSTOMER_ACTIONS_PER_MINUTE = "1000";
process.env.RATE_LIMIT_ADMIN_SESSION_ACTIONS_PER_MINUTE = "1000";
process.env.RATE_LIMIT_PUBLIC_PER_MINUTE = "1000";

const { app } = await import("../src/server.js");
const { pool } = await import("../src/db.js");
const { hashToken } = await import("../src/auth.js");

const suffix = randomBytes(5).toString("hex");

function cookieValues(response) {
  return (response.headers.getSetCookie?.() || []).map((value) => value.split(";", 1)[0]);
}
function mergeCookies(current, values) {
  const jar = new Map((current || "").split("; ").filter(Boolean).map((value) => [value.split("=", 1)[0], value]));
  for (const value of values) jar.set(value.split("=", 1)[0], value);
  return [...jar.values()].join("; ");
}

test("Danube Milano order notification emails", async (t) => {
  const realFetch = globalThis.fetch;
  const sentMail = [];
  let handler = () => new Response(JSON.stringify({ messageId: "<ok@brevo>" }), { status: 201, headers: { "Content-Type": "application/json" } });
  globalThis.fetch = (input, options) => {
    if (String(input) === "https://api.brevo.com/v3/smtp/email") {
      sentMail.push({ headers: options.headers, body: JSON.parse(options.body) });
      return Promise.resolve(handler(input, options));
    }
    return realFetch(input, options);
  };

  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const createdOrderIds = new Set();
  const createdProductIds = new Set();
  const adminEmail = `admin-${suffix}@example.com`;
  const adminPassword = randomBytes(16).toString("base64url");
  const salt = randomBytes(16).toString("hex");
  await pool.execute("INSERT INTO admin_users (email, password_hash) VALUES (?, ?)", [adminEmail, `${salt}:${scryptSync(adminPassword, salt, 64).toString("hex")}`]);

  t.after(async () => {
    globalThis.fetch = realFetch;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    for (const orderId of createdOrderIds) {
      await pool.execute("DELETE FROM order_events WHERE order_id = ?", [orderId]);
    }
    for (const orderId of createdOrderIds) {
      await pool.execute("DELETE FROM order_items WHERE order_id = ?", [orderId]);
    }
    for (const orderId of createdOrderIds) {
      await pool.execute("DELETE FROM order_recovery_tokens WHERE order_id = ?", [orderId]);
    }
    for (const orderId of createdOrderIds) {
      await pool.execute("DELETE FROM guest_session_orders WHERE order_id = ?", [orderId]);
    }
    for (const orderId of createdOrderIds) {
      await pool.execute("UPDATE checkout_idempotency_keys SET order_id = NULL WHERE order_id = ?", [orderId]);
    }
    for (const orderId of createdOrderIds) {
      await pool.execute("DELETE FROM orders WHERE id = ?", [orderId]);
    }
    for (const productId of createdProductIds) await pool.execute("DELETE FROM products WHERE id = ?", [productId]);
    await pool.execute("DELETE FROM customers WHERE email LIKE ?", [`%-${suffix}@example.com`]);
    await pool.execute("DELETE FROM admin_sessions WHERE admin_user_id IN (SELECT id FROM admin_users WHERE email = ?)", [adminEmail]);
    await pool.execute("DELETE FROM admin_users WHERE email = ?", [adminEmail]);
    await pool.end();
  });

  async function call(path, { method = "GET", body, cookie, csrf } = {}) {
    const headers = {};
    if (method !== "GET") headers.Origin = process.env.WEB_ORIGIN;
    if (body) headers["Content-Type"] = "application/json";
    if (cookie) headers.Cookie = cookie;
    if (csrf) headers["X-CSRF-Token"] = csrf;
    const response = await fetch(base + path, { method, headers, ...(body && { body: JSON.stringify(body) }) });
    const cookies = new Map((cookie || "").split(/;\s*/).filter(Boolean).map((v) => [v.slice(0, v.indexOf("=")), v]));
    for (const value of response.headers.getSetCookie()) {
      const entry = value.split(";", 1)[0];
      cookies.set(entry.slice(0, entry.indexOf("=")), entry);
    }
    const values = [...cookies.values()];
    return { status: response.status, data: response.status === 204 ? null : await response.json(), cookie: values.join("; "), cookies: values };
  }

  async function waitFor(predicate, timeout = 4000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (predicate()) return true;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return false;
  }
  const orderMail = (subject) => sentMail.filter((mail) => mail.body.subject === subject);
  const anyOrderMail = () => sentMail.filter((mail) => mail.body.subject.startsWith("Your Danube Milano order"));
  const reset = () => { sentMail.length = 0; };

  async function product({ name = "Order Item", priceFils = 12345, stock = 5, sku } = {}) {
    const slug = `order-${suffix}-${randomBytes(4).toString("hex")}`;
    const [result] = await pool.execute(
      "INSERT INTO products (slug, name, description, sku, price_fils, stock) VALUES (?, ?, '<p>Test</p>', ?, ?, ?)",
      [slug, name, sku || `ORD-${suffix}-${randomBytes(4).toString("hex")}`, priceFils, stock],
    );
    createdProductIds.add(result.insertId);
    return { id: result.insertId, priceFils, stock };
  }

  async function cartWith(item, quantity = 1) {
    let cookie = "";
    const cart = await call("/api/cart");
    cookie = mergeCookies(cookie, cart.cookies);
    const added = await call("/api/cart/items", { method: "POST", cookie, body: { productId: item.id, quantity } });
    return mergeCookies(cookie, added.cookies);
  }

  function checkoutBody(item, idempotencyKey, overrides = {}) {
    return {
      name: "Order Buyer",
      email: `order-${suffix}@example.com`,
      phone: "+971 50 123 4567",
      address: "123 Main Street, Dubai",
      expectedTotalFils: item.priceFils,
      idempotencyKey,
      ...overrides,
    };
  }

  async function place(item, overrides = {}) {
    const cookie = await cartWith(item, overrides.quantity || 1);
    const body = checkoutBody(item, overrides.idempotencyKey || `idem-${randomBytes(6).toString("hex")}`, overrides);
    const placed = await call("/api/checkout", { method: "POST", cookie, body });
    assert.equal(placed.status, 201, JSON.stringify(placed.data));
    createdOrderIds.add(placed.data.orderId);
    return { placed, cookie: mergeCookies(cookie, placed.cookies), body };
  }

  const login = await call("/api/admin/login", { method: "POST", body: { email: adminEmail, password: adminPassword } });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  const admin = (path, method = "GET", body) => call(path, { method, body, cookie: login.cookie, csrf: login.data.csrfToken });

  await t.test("guest order confirmation email contains items, totals and payment wording", async () => {
    reset();
    const item = await product({ name: "Brushed Brass Tap", priceFils: 12345, stock: 5 });
    const { placed } = await place(item);
    const confirmed = await waitFor(() => orderMail(`Your Danube Milano order ${placed.data.orderNumber} is confirmed`).length === 1);
    assert.equal(confirmed, true);
    const mail = orderMail(`Your Danube Milano order ${placed.data.orderNumber} is confirmed`)[0];
    assert.equal(mail.body.to[0].email, `order-${suffix}@example.com`);
    assert.match(mail.body.subject, /confirmed/);
    assert.match(mail.body.htmlContent, /Brushed Brass Tap/);
    assert.match(mail.body.htmlContent, /AED 123\.45/);
    assert.match(mail.body.htmlContent, /Cash on Delivery/);
    assert.match(mail.body.htmlContent, /Unpaid/);
    assert.ok(mail.body.textContent.includes("Brushed Brass Tap"));
    assert.ok(mail.body.textContent.includes("AED 123.45"));
  });

  await t.test("registered customer order confirmation", async () => {
    reset();
    const email = `reg-${suffix}@example.com`;
    const password = "secure-test-password";
    const registration = await call("/api/customer/register", { method: "POST", body: { name: "Reg Buyer", email } });
    assert.equal(registration.status, 202);
    const verification = sentMail.find((mail) => mail.body.subject === "Verify your Danube Milano account");
    const token = verification.body.htmlContent.match(/#([A-Za-z0-9_-]{43})/)?.[1];
    const activated = await call("/api/customer/verification/confirm", { method: "POST", body: { token, password } });
    assert.equal(activated.status, 200);
    const accountCookie = mergeCookies("", activated.cookies);
    reset();
    const item = await product({ name: "Marble Tray", priceFils: 5000, stock: 3 });
    const cookie = await cartWith(item);
    const body = checkoutBody(item, `reg-${randomBytes(8).toString("hex")}`, { email });
    const placed = await call("/api/checkout", { method: "POST", cookie: mergeCookies(cookie, accountCookie), body });
    assert.equal(placed.status, 201, JSON.stringify(placed.data));
    createdOrderIds.add(placed.data.orderId);
    const confirmed = await waitFor(() => anyOrderMail().some((mail) => mail.body.to[0].email === email));
    assert.equal(confirmed, true);
    assert.equal(anyOrderMail().find((mail) => mail.body.to[0].email === email).body.to[0].email, email);
  });

  await t.test("checkout replay and concurrent duplicates send only one confirmation", async () => {
    reset();
    const item = await product({ name: "Replay Item", priceFils: 8000, stock: 5 });
    const cookie = await cartWith(item);
    const body = checkoutBody(item, `replay-${randomBytes(5).toString("hex")}`);
    const [first, second] = await Promise.all([
      call("/api/checkout", { method: "POST", cookie, body }),
      call("/api/checkout", { method: "POST", cookie, body }),
    ]);
    assert.equal([first, second].filter((r) => r.status === 201).length, 1);
    for (const result of [first, second]) if (result.status === 201) createdOrderIds.add(result.data.orderId);
    const replay = await call("/api/checkout", { method: "POST", cookie, body });
    assert.equal(replay.status, 200);
    const sent = await waitFor(() => anyOrderMail().length >= 1);
    assert.equal(sent, true);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(anyOrderMail().length, 1, "replay must not resend confirmation");
  });

  await t.test("initial preparing transition sends exactly one preparing email", async () => {
    reset();
    const item = await product({ name: "Prepare Item", priceFils: 6000, stock: 5 });
    const { placed } = await place(item);
    await waitFor(() => anyOrderMail().length === 1);
    const response = await admin(`/api/admin/orders/${placed.data.orderId}/status`, "PATCH", { status: "processing" });
    assert.equal(response.status, 200);
    const sent = await waitFor(() => orderMail(`Your Danube Milano order ${placed.data.orderNumber} is being prepared`).length === 1);
    assert.equal(sent, true);
    assert.equal(anyOrderMail().length, 2);
  });

  await t.test("every supported status transition sends the matching email with tracking", async () => {
    reset();
    const item = await product({ name: "Dispatch Item", priceFils: 7000, stock: 5 });
    const { placed } = await place(item);
    await waitFor(() => anyOrderMail().length === 1);
    const number = placed.data.orderNumber;

    assert.equal((await admin(`/api/admin/orders/${placed.data.orderId}/status`, "PATCH", { status: "processing" })).status, 200);
    assert.equal(await waitFor(() => orderMail(`Your Danube Milano order ${number} is being prepared`).length === 1), true);

    assert.equal((await admin(`/api/admin/orders/${placed.data.orderId}/status`, "PATCH", { status: "shipped", carrier: "Aramex", trackingNumber: "TRK-1", trackingUrl: "https://example.com/track/1" })).status, 200);
    assert.equal(await waitFor(() => orderMail(`Your Danube Milano order ${number} has shipped`).length === 1), true);
    const shipped = orderMail(`Your Danube Milano order ${number} has shipped`)[0];
    assert.match(shipped.body.htmlContent, /Aramex/);
    assert.match(shipped.body.htmlContent, /TRK-1/);
    assert.match(shipped.body.htmlContent, /https:\/\/example\.com\/track\/1/);

    assert.equal((await admin(`/api/admin/orders/${placed.data.orderId}/status`, "PATCH", { status: "delivered", carrier: "Aramex", trackingNumber: "TRK-1" })).status, 200);
    assert.equal(await waitFor(() => orderMail(`Your Danube Milano order ${number} has been delivered`).length === 1), true);

    const cancelItem = await product({ name: "Cancel Item", priceFils: 9000, stock: 5 });
    const cancelled = await place(cancelItem);
    await waitFor(() => anyOrderMail().length >= 1);
    assert.equal((await admin(`/api/admin/orders/${cancelled.placed.data.orderId}/status`, "PATCH", { status: "cancelled" })).status, 200);
    assert.equal(await waitFor(() => orderMail(`Your Danube Milano order ${cancelled.placed.data.orderNumber} was cancelled`).length === 1), true);
  });

  await t.test("unchanged status and invalid transitions send no email", async () => {
    reset();
    const item = await product({ name: "No Change Item", priceFils: 4000, stock: 5 });
    const { placed } = await place(item);
    await waitFor(() => anyOrderMail().length === 1);
    reset();

    assert.equal((await admin(`/api/admin/orders/${placed.data.orderId}/status`, "PATCH", { status: "placed" })).status, 400);
    assert.equal((await admin(`/api/admin/orders/${placed.data.orderId}/status`, "PATCH", { status: "processing" })).status, 200);
    await waitFor(() => anyOrderMail().length === 1);
    reset();
    assert.equal((await admin(`/api/admin/orders/${placed.data.orderId}/status`, "PATCH", { status: "processing" })).status, 200);
    assert.equal((await admin(`/api/admin/orders/${placed.data.orderId}/status`, "PATCH", { status: "placed" })).status, 400);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(anyOrderMail().length, 0, "unchanged status must not send");
  });

  await t.test("concurrent identical status updates send a single email", async () => {
    reset();
    const item = await product({ name: "Race Item", priceFils: 5500, stock: 5 });
    const { placed } = await place(item);
    await waitFor(() => anyOrderMail().length === 1);
    reset();
    const [a, b] = await Promise.all([
      admin(`/api/admin/orders/${placed.data.orderId}/status`, "PATCH", { status: "processing" }),
      admin(`/api/admin/orders/${placed.data.orderId}/status`, "PATCH", { status: "processing" }),
    ]);
    assert.ok([a.status, b.status].every((status) => status === 200));
    const sent = await waitFor(() => anyOrderMail().length >= 1);
    assert.equal(sent, true);
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(anyOrderMail().length, 1, "concurrent identical updates must not duplicate");
  });

  await t.test("Brevo missing configuration does not block checkout", async () => {
    reset();
    const original = process.env.BREVO_API_KEY;
    process.env.BREVO_API_KEY = "";
    try {
      const item = await product({ name: "No Config Item", priceFils: 3000, stock: 5 });
      const { placed } = await place(item);
      assert.equal(placed.status, 201);
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(sentMail.length, 0);
    } finally { process.env.BREVO_API_KEY = original; }
  });

  await t.test("Brevo failure and timeout preserve the committed order", async () => {
    const item = await product({ name: "Fail Item", priceFils: 3500, stock: 5 });
    for (const mode of ["http500", "timeout"]) {
      reset();
      handler = () => mode === "http500"
        ? new Response(JSON.stringify({ code: "x", message: "y" }), { status: 500, headers: { "Content-Type": "application/json" } })
        : Promise.reject(new DOMException("aborted", "AbortError"));
      const placed = await call("/api/checkout", { method: "POST", cookie: await cartWith(item, 1), body: checkoutBody(item, `fail-${mode}-${randomBytes(4).toString("hex")}`) });
      assert.equal(placed.status, 201, JSON.stringify(placed.data));
      createdOrderIds.add(placed.data.orderId);
      const [row] = await pool.execute("SELECT status FROM orders WHERE id = ?", [placed.data.orderId]);
      assert.equal(row[0].status, "placed");
    }
    handler = () => new Response(JSON.stringify({ messageId: "<ok@brevo>" }), { status: 201, headers: { "Content-Type": "application/json" } });
  });

  await t.test("HTML escaping and safe order-access URLs", async () => {
    const { renderOrderEmail } = await import("../src/orderEmails.js");
    const mail = renderOrderEmail("created", {
      orderNumber: "DM-00000001",
      name: "<script>alert(1)</script>",
      email: "buyer@example.com",
      currency: "AED",
      totalFils: 1000,
      status: "placed",
      paymentStatus: "unpaid",
      carrier: null,
      trackingNumber: null,
      trackingUrl: null,
      createdAt: new Date(),
      items: [{ productName: "<img src=x onerror=alert(1)>", sku: "SKU-1", unitPriceFils: 1000, quantity: 1 }],
    });
    assert.equal(mail.html.includes("<script>"), false);
    assert.equal(mail.html.includes("<img src=x"), false);
    assert.match(mail.html, /&lt;script&gt;/);
    assert.match(mail.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.equal(mail.html.includes("/orders/recover#"), false);
    assert.equal(/[A-Za-z0-9_-]{43}/.test(mail.html), false, "no token-like value in order email");
    assert.equal(mail.html.includes("bearer"), false);
  });

  await t.test("verification, resend and recovery flows still work", async () => {
    reset();
    const email = `verify-${suffix}@example.com`;
    const password = "secure-test-password";
    const registration = await call("/api/customer/register", { method: "POST", body: { name: "Verify Buyer", email } });
    assert.equal(registration.status, 202);
    assert.equal(sentMail.find((mail) => mail.body.subject === "Verify your Danube Milano account") !== undefined, true);
    const verification = sentMail.find((mail) => mail.body.subject === "Verify your Danube Milano account");
    const token = verification.body.htmlContent.match(/#([A-Za-z0-9_-]{43})/)?.[1];
    assert.equal((await call("/api/customer/verification/confirm", { method: "POST", body: { token, password } })).status, 200);

    const item = await product({ name: "Recovery Item", priceFils: 2500, stock: 5 });
    const { placed } = await place(item, { email });
    await waitFor(() => anyOrderMail().length >= 1);
    reset();
    const recovery = await call("/api/orders/recover", { method: "POST", body: { orderNumber: placed.data.orderNumber, email } });
    assert.equal(recovery.status, 202);
    assert.equal(await waitFor(() => orderMail("Verify your Danube Milano order").length === 1), true);
  });

  await admin("/api/admin/logout", "POST");
});