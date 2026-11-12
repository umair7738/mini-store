import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

process.env.CSRF_SECRET = process.env.CSRF_SECRET || "test-csrf-secret-test-csrf-secret-32";
process.env.WEB_ORIGIN = process.env.WEB_ORIGIN || "http://localhost:3000";
process.env.BREVO_API_KEY = "test-brevo-key";
process.env.EMAIL_FROM = "test@example.com";
process.env.EMAIL_FROM_NAME = "Test Sender";
process.env.RATE_LIMIT_CUSTOMER_AUTH_PER_MINUTE = "100";
process.env.RATE_LIMIT_CUSTOMER_AUTH_PER_ACCOUNT_PER_MINUTE = "100";
process.env.RATE_LIMIT_RECOVERY_PER_15_MINUTES = "100";
process.env.RATE_LIMIT_RECOVERY_PER_EMAIL_15_MINUTES = "100";
process.env.RATE_LIMIT_RECOVERY_VERIFY_PER_15_MINUTES = "100";

const { app } = await import("../src/server.js");
const { pool } = await import("../src/db.js");

const suffix = randomBytes(5).toString("hex");

function brevoResponse(status = 201, body = { messageId: "<ok@brevo>" }) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function assertSafeLogs(logs) {
  const text = logs.flat().join("\n");
  assert.equal(text.includes("test-brevo-key"), false);
  assert.equal(/[A-Za-z0-9_-]{43}/.test(text), false, "verification token-like value leaked in logs");
  assert.equal(/secret|@example\.com/i.test(text.replace(/Transactional email delivery failed|Order recovery email delivery failed|Customer verification email delivery failed/g, "")), false);
}

test("Brevo mail integration verification", async (t) => {
  const realFetch = globalThis.fetch;
  const realError = console.error;
  const orig = { key: process.env.BREVO_API_KEY, from: process.env.EMAIL_FROM, name: process.env.EMAIL_FROM_NAME };
  const logs = [];
  console.error = (...args) => logs.push(args.map(String));
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  t.after(async () => {
    globalThis.fetch = realFetch;
    console.error = realError;
    process.env.BREVO_API_KEY = orig.key;
    process.env.EMAIL_FROM = orig.from;
    process.env.EMAIL_FROM_NAME = orig.name;
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  });

  function restoreEnv() {
    process.env.BREVO_API_KEY = orig.key;
    process.env.EMAIL_FROM = orig.from;
    process.env.EMAIL_FROM_NAME = orig.name;
  }

  function stubBrevo(handler) {
    globalThis.fetch = (input, options) => {
      if (String(input) === "https://api.brevo.com/v3/smtp/email") return handler(input, options);
      return realFetch(input, options);
    };
  }

  async function call(path, { method = "GET", body, cookie, csrf } = {}) {
    const headers = {};
    if (method !== "GET") headers.Origin = process.env.WEB_ORIGIN;
    if (body) headers["Content-Type"] = "application/json";
    if (cookie) headers.Cookie = cookie;
    if (csrf) headers["X-CSRF-Token"] = csrf;
    const response = await fetch(base + path, { method, headers, ...(body && { body: JSON.stringify(body) }) });
    const cookies = new Map((cookie || "").split(/;\s*/).filter(Boolean).map((v) => [v.slice(0, v.indexOf("=")), v]));
    for (const setCookie of response.headers.getSetCookie()) {
      const value = setCookie.split(";", 1)[0];
      cookies.set(value.slice(0, value.indexOf("=")), value);
    }
    return { status: response.status, data: response.status === 204 ? null : await response.json(), cookie: [...cookies.values()].join("; ") };
  }

  async function createMatchableOrder(email) {
    const slug = `brevo-${suffix}-${randomBytes(3).toString("hex")}`;
    const [p] = await pool.execute("INSERT INTO products (slug, name, description, sku, price_fils, stock) VALUES (?, 'Brevo Item', '<p>x</p>', ?, 1000, 5)", [slug, `BRV-${suffix}-${randomBytes(2).toString("hex")}`]);
    const cart = await call("/api/cart");
    await call("/api/cart/items", { method: "POST", cookie: cart.cookie, body: { productId: p.insertId, quantity: 1 } });
    const placed = await call("/api/checkout", { method: "POST", cookie: cart.cookie, body: { name: "Buyer", email, phone: "+971500000000", address: "123 Main Street, Dubai", expectedTotalFils: 1000, idempotencyKey: `idem-${slug}` } });
    assert.equal(placed.status, 201, JSON.stringify(placed.data));
    return placed.data.orderNumber;
  }

  await t.test("missing or invalid API configuration returns safe 503", async () => {
    try {
      stubBrevo(() => { throw new Error("should not send"); });

      process.env.BREVO_API_KEY = "";
      process.env.EMAIL_FROM = "test@example.com";
      let res = await call("/api/customer/register", { method: "POST", body: { name: "No Key", email: `nokey-${suffix}@example.com` } });
      assert.equal(res.status, 503); assert.equal(res.data.code, "EMAIL_NOT_CONFIGURED");
      res = await call("/api/orders/recover", { method: "POST", body: { orderNumber: "DM-00000001", email: `nokey-${suffix}@example.com` } });
      assert.equal(res.status, 503); assert.equal(res.data.code, "EMAIL_NOT_CONFIGURED");

      process.env.BREVO_API_KEY = "test-brevo-key";
      process.env.EMAIL_FROM = "";
      res = await call("/api/customer/register", { method: "POST", body: { name: "No From", email: `nofrom-${suffix}@example.com` } });
      assert.equal(res.status, 503); assert.equal(res.data.code, "EMAIL_NOT_CONFIGURED");

      // resend verification blocked when config missing
      restoreEnv();
      stubBrevo(() => brevoResponse(201));
      const reg = await call("/api/customer/register", { method: "POST", body: { name: "Cfg", email: `cfg-${suffix}@example.com` } });
      assert.equal(reg.status, 202);
      const sess = await call("/api/customer/session", { cookie: reg.cookie });
      process.env.BREVO_API_KEY = "";
      const resend = await call("/api/customer/verification", { method: "POST", cookie: reg.cookie, csrf: sess.data.csrfToken });
      assert.equal(resend.status, 503); assert.equal(resend.data.code, "EMAIL_NOT_CONFIGURED");
    } finally { restoreEnv(); globalThis.fetch = realFetch; }
  });

  await t.test("Brevo request payload, headers, and successful response handling", async () => {
    try {
      restoreEnv();
      let captured;
      stubBrevo((input, options) => {
        captured = { url: String(input), headers: options.headers, body: JSON.parse(options.body), signal: options.signal };
        return brevoResponse(201, { messageId: "<msg-1@brevo>" });
      });
      const email = `Payload-${suffix}@example.com`;
      const reg = await call("/api/customer/register", { method: "POST", body: { name: "Payload User", email } });
      assert.equal(reg.status, 202);
      assert.equal(captured.url, "https://api.brevo.com/v3/smtp/email");
      assert.equal(captured.headers["api-key"], "test-brevo-key");
      assert.equal(captured.headers["Content-Type"], "application/json");
      assert.equal(captured.headers.Accept, "application/json");
      assert.deepEqual(captured.body.sender, { email: "test@example.com", name: "Test Sender" });
      assert.equal(captured.body.to[0].email.toLowerCase(), email.toLowerCase());
      assert.equal(captured.body.subject, "Verify your Danube Milano account");
      assert.match(captured.body.htmlContent, /\/account\/verify#[A-Za-z0-9_-]{43}/);
      assert.ok(captured.signal, "request should have timeout signal");
    } finally { globalThis.fetch = realFetch; restoreEnv(); }
  });

  await t.test("Brevo HTTP 400/401/429/500 map to safe EMAIL_FAILED for verification resend", async () => {
    try {
      restoreEnv();
      const email = `resend-${suffix}@example.com`;
      stubBrevo(() => brevoResponse(201));
      const reg = await call("/api/customer/register", { method: "POST", body: { name: "Resend", email } });
      assert.equal(reg.status, 202);
      const sess = await call("/api/customer/session", { cookie: reg.cookie });
      for (const status of [400, 401, 429, 500]) {
        stubBrevo(() => brevoResponse(status, { code: "bad", message: "x" }));
        const failed = await call("/api/customer/verification", { method: "POST", cookie: reg.cookie, csrf: sess.data.csrfToken });
        assert.equal(failed.status, 503, `status ${status}`);
        assert.equal(failed.data.code, "EMAIL_FAILED");
        assert.equal(JSON.stringify(failed.data).includes("test-brevo-key"), false);
      }
    } finally { globalThis.fetch = realFetch; restoreEnv(); }
  });

  await t.test("network failure and timeout handled safely without retries", async () => {
    try {
      restoreEnv();
      const email = `net-${suffix}@example.com`;
      stubBrevo(() => brevoResponse(201));
      const reg = await call("/api/customer/register", { method: "POST", body: { name: "Net", email } });
      assert.equal(reg.status, 202);
      const sess = await call("/api/customer/session", { cookie: reg.cookie });
      let calls = 0;
      stubBrevo(() => { calls++; return Promise.reject(new Error("network down")); });
      const net = await call("/api/customer/verification", { method: "POST", cookie: reg.cookie, csrf: sess.data.csrfToken });
      assert.equal(net.status, 503); assert.equal(net.data.code, "EMAIL_FAILED"); assert.equal(calls, 1);

      calls = 0;
      stubBrevo(() => { calls++; return Promise.reject(new DOMException("aborted", "AbortError")); });
      const tout = await call("/api/customer/verification", { method: "POST", cookie: reg.cookie, csrf: sess.data.csrfToken });
      assert.equal(tout.status, 503); assert.equal(tout.data.code, "EMAIL_FAILED"); assert.equal(calls, 1);
    } finally { globalThis.fetch = realFetch; restoreEnv(); }
  });

  await t.test("registration remains retryable after email send failure", async () => {
    try {
      restoreEnv();
      const email = `retry-${suffix}@example.com`;
      let calls = 0;
      stubBrevo(() => { calls++; return brevoResponse(500); });
      const first = await call("/api/customer/register", { method: "POST", body: { name: "Retry User", email } });
      assert.equal(first.status, 202, JSON.stringify(first.data));
      assert.equal(calls, 1);
      const sess = await call("/api/customer/session", { cookie: first.cookie });
      assert.equal(sess.data.customer?.email?.toLowerCase(), email.toLowerCase());
      assert.equal(sess.data.customer?.verified, false);

      calls = 0;
      stubBrevo(() => { calls++; return brevoResponse(201); });
      const resend = await call("/api/customer/verification", { method: "POST", cookie: first.cookie, csrf: sess.data.csrfToken });
      assert.equal(resend.status, 200);
      assert.equal(resend.data.message, "Check your email for a verification link.");
      assert.equal(calls, 1);
    } finally { globalThis.fetch = realFetch; restoreEnv(); }
  });

  await t.test("verification resend failure semantics preserved", async () => {
    try {
      restoreEnv();
      const email = `vresend-${suffix}@example.com`;
      stubBrevo(() => brevoResponse(201));
      const reg = await call("/api/customer/register", { method: "POST", body: { name: "VR", email } });
      assert.equal(reg.status, 202);
      const sess = await call("/api/customer/session", { cookie: reg.cookie });
      stubBrevo(() => brevoResponse(401));
      const failed = await call("/api/customer/verification", { method: "POST", cookie: reg.cookie, csrf: sess.data.csrfToken });
      assert.equal(failed.status, 503);
      assert.equal(failed.data.code, "EMAIL_FAILED");
      stubBrevo(() => brevoResponse(201));
      const ok = await call("/api/customer/verification", { method: "POST", cookie: reg.cookie, csrf: sess.data.csrfToken });
      assert.equal(ok.status, 200);
    } finally { globalThis.fetch = realFetch; restoreEnv(); }
  });

  await t.test("recovery anti-enumeration and failure behavior preserved", async () => {
    try {
      restoreEnv();
      let sent = 0;
      stubBrevo((input, options) => {
        sent++;
        const body = JSON.parse(options.body);
        assert.equal(body.subject, "Verify your Danube Milano order");
        assert.match(body.htmlContent, /\/orders\/recover#[A-Za-z0-9_-]{43}/);
        return brevoResponse(429);
      });
      const noMatch = await call("/api/orders/recover", { method: "POST", body: { orderNumber: "DM-99999999", email: `nomatch-${suffix}@example.com` } });
      assert.equal(noMatch.status, 202);
      assert.equal(noMatch.data.message, "If the order details match, a verification link will be sent to the checkout email.");
      assert.equal(sent, 0);

      const matchEmail = `match-${suffix}@example.com`;
      const orderNumber = await createMatchableOrder(matchEmail);
      const matched = await call("/api/orders/recover", { method: "POST", body: { orderNumber, email: matchEmail } });
      assert.equal(matched.status, 202);
      assert.equal(matched.data.message, "If the order details match, a verification link will be sent to the checkout email.");
      assert.equal(sent, 1);

      stubBrevo(() => { sent++; return Promise.reject(new Error("timeout-ish")); });
      const matchedNet = await call("/api/orders/recover", { method: "POST", body: { orderNumber, email: matchEmail } });
      assert.equal(matchedNet.status, 202);
      assert.equal(sent, 2);
    } finally { globalThis.fetch = realFetch; restoreEnv(); }
  });

  await t.test("server logs do not contain secrets or verification tokens", async () => {
    assertSafeLogs(logs);
  });
});
