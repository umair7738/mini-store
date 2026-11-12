import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import { hashToken } from "../src/auth.js";
import { app } from "../src/server.js";
import { pool } from "../src/db.js";

const suffix = randomBytes(5).toString("hex").toUpperCase();
const product = (name, priceFils = 25000, stock = 5) => ({
  slug: `${name}-${suffix}`.toLowerCase(), name,
  description: "<p>A durable product for a modern bathroom.</p>",
  sku: `DM-${name.replace(/[^A-Z0-9]/gi, "").toUpperCase()}-${suffix}`,
  priceFils, stock,
});

test("product-only API, cart, checkout and order history", async (t) => {
  const [database] = await pool.query("SELECT DATABASE() AS name, VERSION() AS version");
  assert.equal(database[0].name, "mini_store_test");
  assert.match(database[0].version, /^8\.4\./);
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await pool.end(); });
  async function call(path, { method = "GET", body, cookie, csrf, orderToken } = {}) {
    const headers = {};
    if (method !== "GET") headers.Origin = process.env.WEB_ORIGIN;
    if (body) headers["Content-Type"] = "application/json";
    if (cookie) headers.Cookie = cookie;
    if (csrf) headers["X-CSRF-Token"] = csrf;
    if (orderToken) headers["X-Order-Token"] = orderToken;
    const response = await fetch(base + path, { method, headers, ...(body && { body: JSON.stringify(body) }) });
    return { status: response.status, data: response.status === 204 ? null : await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
  }
  const email = `test-${suffix}@example.com`;
  const password = randomBytes(16).toString("base64url");
  const salt = randomBytes(16).toString("hex");
  await pool.execute("INSERT INTO admin_users (email, password_hash) VALUES (?, ?)", [email, `${salt}:${scryptSync(password, salt, 64).toString("hex")}`]);
  const login = await call("/api/admin/login", { method: "POST", body: { email, password } });
  assert.equal(login.status, 200);
  const admin = (path, method = "GET", body, token = login.data.csrfToken) => call(path, { method, body, cookie: login.cookie, csrf: token });

  await t.test("product CRUD validates data and sanitizes rich descriptions", async () => {
    assert.equal((await call("/api/admin/products")).status, 401);
    const created = await admin("/api/admin/products", "POST", product("basin", 59900, 12));
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const slug = `basin-${suffix.toLowerCase()}`;
    const detail = await call(`/api/products/${slug}`);
    assert.equal(detail.data.product.priceFils, 59900);
    assert.equal(detail.data.product.stock, 12);
    assert.equal(detail.data.product.description, "<p>A durable product for a modern bathroom.</p>");
    const updated = await admin(`/api/admin/products/${created.data.id}`, "PUT", { ...product("basin", 65000, 9), description: "<p>Updated <script>alert(1)</script><strong>description</strong></p>" });
    assert.equal(updated.status, 200);
    const after = await call(`/api/products/${slug}`);
    assert.equal(after.data.product.priceFils, 65000);
    assert.equal(after.data.product.description, "<p>Updated <strong>description</strong></p>");
    assert.equal((await admin(`/api/admin/products/${created.data.id}`, "DELETE")).status, 204);
    assert.equal((await call(`/api/products/${slug}`)).status, 404);
  });

  await t.test("product cart merges lines and enforces quantity and stock", async () => {
    const created = await admin("/api/admin/products", "POST", product("cart-item", 25000, 3));
    const productId = created.data.id;
    const cart = await call("/api/cart");
    const add = (quantity) => call("/api/cart/items", { method: "POST", cookie: cart.cookie, body: { productId, quantity } });
    assert.equal((await add(21)).status, 400);
    assert.equal((await add(2)).data.items[0].productId, productId);
    assert.equal((await add(1)).data.items[0].quantity, 3);
    assert.equal((await add(1)).status, 409);
    assert.equal((await call(`/api/cart/items/${productId}`, { method: "PATCH", cookie: cart.cookie, body: { quantity: 2 } })).data.totalFils, 50000);
    assert.equal((await call(`/api/cart/items/${productId}`, { method: "DELETE", cookie: cart.cookie })).data.items.length, 0);
  });

  await t.test("checkout uses locked product price and stock, snapshots order details, and restocks cancellation", async () => {
    const made = await admin("/api/admin/products", "POST", product("checkout", 40000, 2));
    const item = (await call(`/api/products/checkout-${suffix.toLowerCase()}`)).data.product;
    const cart = await call("/api/cart");
    await call("/api/cart/items", { method: "POST", cookie: cart.cookie, body: { productId: item.id, quantity: 1 } });
    const body = { name: "Test Buyer", email: `buyer-${suffix}@example.com`, phone: "+971 50 123 4567", address: "123 Main Street, Dubai", expectedTotalFils: 40000, idempotencyKey: `checkout-${suffix.toLowerCase()}` };
    assert.equal((await call("/api/checkout", { method: "POST", cookie: cart.cookie, body: { ...body, idempotencyKey: `${body.idempotencyKey}-price-check`, expectedTotalFils: 1 } })).data.code, "PRICE_CHANGED");
    const placed = await call("/api/checkout", { method: "POST", cookie: cart.cookie, body });
    assert.equal(placed.status, 201, JSON.stringify(placed.data));
    assert.match(placed.data.orderNumber, /^DM-\d{8,10}$/);
    assert.equal(placed.data.confirmationRef, undefined);
    assert.equal((await call(`/api/orders/${placed.data.orderNumber}`, { cookie: placed.cookie })).data.order.items[0].sku, item.sku);
    assert.equal((await call(`/api/orders/${placed.data.orderNumber}`)).status, 404);
    assert.equal((await call("/api/orders", { cookie: placed.cookie })).data.orders[0].orderNumber, placed.data.orderNumber);
    assert.equal((await call("/api/orders/forget-device", { method: "POST", cookie: placed.cookie })).status, 204);
    assert.equal((await call(`/api/orders/${placed.data.orderNumber}`, { cookie: placed.cookie })).status, 404);
    const accountPassword = randomBytes(16).toString("base64url");
    const account = await call("/api/customer/register", { method: "POST", body: { name: "Test Buyer", email: `buyer-${suffix}@example.com`, phone: "+971 50 123 4567", password: accountPassword } });
    assert.equal(account.status, 201);
    assert.equal((await call("/api/orders", { cookie: account.cookie })).data.orders.length, 0);
    const other = await call("/api/customer/register", { method: "POST", body: { name: "Other Buyer", email: `other-${suffix}@example.com`, password: randomBytes(16).toString("base64url") } });
    assert.equal((await call(`/api/orders/${placed.data.orderNumber}`, { cookie: other.cookie })).status, 404);
    const address = await call("/api/customer/addresses", { method: "POST", cookie: account.cookie, csrf: account.data.customer.csrfToken, body: { label: "Home", name: "Test Buyer", phone: "+971 50 123 4567", address: "123 Main Street, Dubai" } });
    assert.equal(address.status, 201);
    assert.equal((await call("/api/customer/addresses", { cookie: account.cookie })).data.addresses.length, 1);
    const recoveryToken = randomBytes(32).toString("base64url");
    await pool.execute("INSERT INTO order_recovery_tokens (token_hash, order_id, expires_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 15 MINUTE))", [hashToken(recoveryToken), placed.data.orderId]);
    const verified = await call("/api/orders/recover/verify", { method: "POST", body: { token: recoveryToken } });
    assert.equal(verified.data.orderNumber, placed.data.orderNumber);
    assert.equal((await call("/api/orders", { cookie: account.cookie })).data.orders.length, 1);
    await call(`/api/customer/addresses/${address.data.id}`, { method: "PUT", cookie: account.cookie, csrf: account.data.customer.csrfToken, body: { label: "Apartment", name: "Test Buyer", phone: "+971 50 123 4567", address: "123 Main Street, Dubai" } });
    assert.equal((await call("/api/customer/addresses", { cookie: account.cookie })).data.addresses[0].label, "Apartment");
    const loggedIn = await call("/api/customer/login", { method: "POST", body: { email: `buyer-${suffix}@example.com`, password: "wrong-password" } });
    assert.equal(loggedIn.status, 401);
    const relogin = await call("/api/customer/login", { method: "POST", body: { email: `buyer-${suffix}@example.com`, password: accountPassword } });
    assert.equal(relogin.status, 200);
    assert.equal((await call("/api/orders", { cookie: relogin.cookie })).data.orders.length, 1);
    await call("/api/customer/profile", { method: "PUT", cookie: relogin.cookie, csrf: relogin.data.customer.csrfToken, body: { name: "Updated Buyer", phone: "+971 50 987 6543" } });
    assert.equal((await call("/api/customer/session", { cookie: relogin.cookie })).data.customer.name, "Updated Buyer");
    assert.equal((await call("/api/customer/logout", { method: "POST", cookie: relogin.cookie, csrf: relogin.data.customer.csrfToken })).status, 204);
    assert.equal((await call("/api/orders", { cookie: relogin.cookie })).data.orders.length, 0);
    const signedIn = await call("/api/customer/login", { method: "POST", body: { email: `buyer-${suffix}@example.com`, password: accountPassword } });
    assert.equal((await call("/api/orders", { cookie: signedIn.cookie })).data.orders.length, 1);
    if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) assert.equal((await call("/api/orders/recover", { method: "POST", body: { orderNumber: placed.data.orderNumber, email: `buyer-${suffix}@example.com` } })).status, 503);
    await admin(`/api/admin/products/${made.data.id}`, "PUT", { ...product("checkout", 90000, 0), description: "<p>Changed after purchase</p>" });
    const order = await admin(`/api/admin/orders/${placed.data.orderId}`);
    assert.equal(order.data.order.items[0].unitPriceFils, 40000);
    assert.equal(order.data.order.items[0].productName, "checkout");
    assert.equal((await admin(`/api/admin/orders/${placed.data.orderId}/status`, "PATCH", { status: "cancelled" })).status, 200);
    const [stock] = await pool.execute("SELECT stock FROM products WHERE id = ?", [made.data.id]);
    assert.equal(stock[0].stock, 1);

    const second = await admin("/api/admin/products", "POST", product("buy-now", 45000, 4));
    const keptItem = await admin("/api/admin/products", "POST", product("kept-cart", 12000, 4));
    const activeCart = await call("/api/cart", { cookie: verified.cookie });
    const browserCookies = `${activeCart.cookie}; ${verified.cookie}`;
    await call("/api/cart/items", { method: "POST", cookie: activeCart.cookie, body: { productId: keptItem.data.id, quantity: 1 } });
    const bought = await call("/api/checkout", { method: "POST", cookie: browserCookies, body: { name: "Test Buyer", email: `buyer-${suffix}@example.com`, phone: "+971 50 123 4567", address: "123 Main Street, Dubai", expectedTotalFils: 90000, idempotencyKey: `buy-now-${suffix.toLowerCase()}`, buyNow: { productId: second.data.id, quantity: 2 } } });
    assert.equal(bought.status, 201, JSON.stringify(bought.data));
    const retainedCart = await call("/api/cart", { cookie: activeCart.cookie });
    assert.equal(retainedCart.data.items.length, 1);
    assert.equal(retainedCart.data.items[0].productId, keptItem.data.id);
    assert.equal((await call(`/api/orders/${bought.data.orderNumber}`, { cookie: browserCookies })).status, 200);
    await pool.execute("UPDATE guest_sessions SET expires_at = DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 1 DAY) WHERE token_hash = ?", [hashToken(verified.cookie.split("=")[1])]);
    assert.equal((await call(`/api/orders/${bought.data.orderNumber}`, { cookie: browserCookies })).status, 404);
  });
  await admin("/api/admin/logout", "POST");
});
