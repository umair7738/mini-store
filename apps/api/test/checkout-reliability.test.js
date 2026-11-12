import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

process.env.RATE_LIMIT_CHECKOUT_PER_MINUTE = "100";
process.env.RATE_LIMIT_CHECKOUT_SESSION_PER_MINUTE = "100";
process.env.RATE_LIMIT_CUSTOMER_AUTH_PER_MINUTE = "100";
process.env.RATE_LIMIT_CUSTOMER_AUTH_PER_ACCOUNT_PER_MINUTE = "100";
process.env.BREVO_API_KEY = "test-brevo-key";
process.env.EMAIL_FROM = "test@example.com";
process.env.EMAIL_FROM_NAME = "Test Sender";
const { app } = await import("../src/server.js");
const { pool } = await import("../src/db.js");
const { hashToken } = await import("../src/auth.js");

const suffix = randomBytes(6).toString("hex");

function cookieValues(response) {
  const values = response.headers.getSetCookie?.() || [];
  const fallback = response.headers.get("set-cookie");
  return (values.length ? values : fallback ? fallback.split(/, (?=[^;]+?=)/) : [])
    .map((value) => value.split(";", 1)[0]);
}

function mergeCookies(current, values) {
  const jar = new Map((current || "").split("; ").filter(Boolean).map((value) => [value.split("=", 1)[0], value]));
  for (const value of values) jar.set(value.split("=", 1)[0], value);
  return [...jar.values()].join("; ");
}

test("checkout idempotency and concurrency use real database transactions", async (t) => {
  const realFetch = globalThis.fetch;
  const sentMail = [];
  globalThis.fetch = (input, options) => {
    if (String(input) === "https://api.brevo.com/v3/smtp/email") {
      sentMail.push({ headers: options.headers, body: JSON.parse(options.body) });
      return Promise.resolve(new Response(JSON.stringify({ messageId: "<test@brevo>" }), { status: 201, headers: { "Content-Type": "application/json" } }));
    }
    return realFetch(input, options);
  };
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { globalThis.fetch = realFetch; await new Promise((resolve) => server.close(resolve)); await pool.end(); });

  async function call(path, { method = "GET", body, cookie, csrf } = {}) {
    const headers = {};
    if (method !== "GET") headers.Origin = process.env.WEB_ORIGIN;
    if (body) headers["Content-Type"] = "application/json";
    if (cookie) headers.Cookie = cookie;
    if (csrf) headers["X-CSRF-Token"] = csrf;
    const response = await fetch(base + path, { method, headers, ...(body && { body: JSON.stringify(body) }) });
    return {
      status: response.status,
      data: response.status === 204 ? null : await response.json(),
      cookies: cookieValues(response),
    };
  }

  async function product(priceFils, stock) {
    const slug = `reliability-${suffix}-${randomBytes(4).toString("hex")}`;
    const sku = `REL-${suffix}-${randomBytes(4).toString("hex")}`;
    const [result] = await pool.execute(
      "INSERT INTO products (slug, name, description, sku, price_fils, stock) VALUES (?, ?, '<p>Test</p>', ?, ?, ?)",
      [slug, "Reliability test product", sku, priceFils, stock],
    );
    return { id: result.insertId, priceFils, stock };
  }

  async function cartWithItem(item, quantity = 1) {
    let cookie = "";
    const cart = await call("/api/cart");
    cookie = mergeCookies(cookie, cart.cookies);
    const added = await call("/api/cart/items", { method: "POST", cookie, body: { productId: item.id, quantity } });
    cookie = mergeCookies(cookie, added.cookies);
    return cookie;
  }

  function checkoutBody(item, idempotencyKey, overrides = {}) {
    return {
      name: "Reliability Buyer",
      email: `reliability-${suffix}@example.com`,
      phone: "+971 50 123 4567",
      address: "123 Main Street, Dubai",
      expectedTotalFils: item.priceFils,
      idempotencyKey,
      ...overrides,
    };
  }

  async function stock(item) {
    const [rows] = await pool.execute("SELECT stock FROM products WHERE id = ?", [item.id]);
    return rows[0].stock;
  }

  async function buyNowIntent(cookie, item, quantity) {
    const prepared = await call("/api/checkout/intent", { method: "POST", cookie, body: { productId: item.id, quantity } });
    assert.equal(prepared.status, 200, JSON.stringify(prepared.data));
    return { ...prepared.data, cookie: mergeCookies(cookie, prepared.cookies) };
  }

  function latestVerificationToken() {
    return sentMail.at(-1)?.body?.htmlContent.match(/#([A-Za-z0-9_-]{43})/)?.[1];
  }

  await t.test("checkout remembers an unverified customer and verification enables sign in", async () => {
    const item = await product(21000, 2);
    const cookie = await cartWithItem(item);
    const email = `verify-${suffix}@example.com`;
    const body = checkoutBody(item, `verify-${suffix}`, { email });
    const placed = await call("/api/checkout", { method: "POST", cookie, body });
    assert.equal(placed.status, 201);
    const customerCookie = mergeCookies(cookie, placed.cookies);
    const session = await call("/api/customer/session", { cookie: customerCookie });
    assert.equal(session.data.customer.email, email);
    assert.equal(session.data.customer.verified, false);
    assert.equal((await call("/api/customer/addresses", { cookie: customerCookie })).status, 403);
    assert.equal((await call("/api/orders", { cookie: customerCookie })).data.orders.length, 1);
    assert.equal((await call("/api/orders", { cookie })).data.orders[0].orderNumber, placed.data.orderNumber);
    const replay = await call("/api/checkout", { method: "POST", cookie: customerCookie, body });
    assert.equal(replay.status, 200);
    assert.equal(replay.data.orderId, placed.data.orderId);
    const registration = await call("/api/customer/register", { method: "POST", cookie: customerCookie, body: { name: "Reliability Buyer", email } });
    assert.equal(registration.status, 202);
    assert.equal((await call("/api/customer/session", { cookie: customerCookie })).data.customer.id, session.data.customer.id);
    const token = latestVerificationToken();
    assert.ok(token);
    const password = "secure-test-password";
    const activated = await call("/api/customer/verification/confirm", { method: "POST", body: { token, password } });
    assert.equal(activated.status, 200);
    assert.equal((await call("/api/customer/verification/confirm", { method: "POST", body: { token, password } })).status, 400);
    const oldCustomerCookie = customerCookie.split("; ").find((value) => value.startsWith("mini_customer="));
    assert.equal((await call("/api/customer/session", { cookie: oldCustomerCookie })).data.customer, null);
    const activatedCookie = mergeCookies(customerCookie, activated.cookies);
    assert.equal((await call("/api/customer/session", { cookie: activatedCookie })).data.customer.verified, true);
    assert.equal((await call("/api/orders", { cookie: activatedCookie })).data.orders[0].orderNumber, placed.data.orderNumber);
    const login = await call("/api/customer/login", { method: "POST", body: { email, password } });
    assert.equal(login.status, 200);
    assert.equal((await call("/api/orders", { cookie: mergeCookies("", login.cookies) })).data.orders[0].orderNumber, placed.data.orderNumber);
  });

  await t.test("checkout with an existing email cannot access that customer's orders", async () => {
    const email = `existing-${suffix}@example.com`;
    const password = "secure-test-password";
    const registration = await call("/api/customer/register", { method: "POST", body: { name: "Existing", email } });
    assert.equal(registration.status, 202);
    const pendingAccountCookie = mergeCookies("", registration.cookies);
    const pendingAccount = await call("/api/customer/session", { cookie: pendingAccountCookie });
    assert.equal(pendingAccount.data.customer.verified, false);
    const activation = await call("/api/customer/verification/confirm", { method: "POST", body: { token: latestVerificationToken(), password } });
    assert.equal(activation.status, 200);
    const accountCookie = mergeCookies(pendingAccountCookie, activation.cookies);
    const account = await call("/api/customer/session", { cookie: accountCookie });
    assert.equal(account.data.customer.verified, true);
    const duplicate = await call("/api/customer/register", { method: "POST", body: { name: "Duplicate", email } });
    assert.equal(duplicate.status, 202);
    assert.equal(duplicate.data.message, registration.data.message);
    const item = await product(22000, 2);
    const cookie = await cartWithItem(item);
    const placed = await call("/api/checkout", { method: "POST", cookie, body: checkoutBody(item, `existing-${suffix}`, { email }) });
    assert.equal(placed.status, 201);
    const current = mergeCookies(cookie, placed.cookies);
    const session = await call("/api/customer/session", { cookie: current });
    assert.notEqual(session.data.customer.id, account.data.customer.id);
    assert.equal((await call("/api/orders", { cookie: accountCookie })).data.orders.length, 0);
    const blockedToken = randomBytes(32).toString("base64url");
    await pool.execute("INSERT INTO customer_verification_tokens (token_hash, customer_id, expires_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 1 HOUR))", [hashToken(blockedToken), session.data.customer.id]);
    assert.equal((await call("/api/customer/verification/confirm", { method: "POST", body: { token: blockedToken, password: "cannot-hijack-account" } })).status, 400);
    const accountLogin = await call("/api/customer/login", { method: "POST", body: { email, password } });
    assert.equal((await call("/api/orders", { cookie: mergeCookies("", accountLogin.cookies) })).data.orders.length, 0);
    const login = await call("/api/customer/login", { method: "POST", cookie: current, body: { email, password } });
    assert.equal(login.status, 200);
    assert.equal((await call("/api/orders", { cookie: mergeCookies(current, login.cookies) })).data.orders[0].orderNumber, placed.data.orderNumber);

    const otherCookie = await cartWithItem(item);
    const otherOrder = await call("/api/checkout", { method: "POST", cookie: otherCookie, body: checkoutBody(item, `existing-other-${suffix}`, { email }) });
    assert.equal(otherOrder.status, 201);
    const plainLogin = await call("/api/customer/login", { method: "POST", body: { email, password } });
    assert.deepEqual((await call("/api/orders", { cookie: mergeCookies("", plainLogin.cookies) })).data.orders.map((order) => order.orderNumber), [placed.data.orderNumber]);

    const recoveryToken = randomBytes(32).toString("base64url");
    await pool.execute("INSERT INTO order_recovery_tokens (token_hash, order_id, expires_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 15 MINUTE))", [hashToken(recoveryToken), otherOrder.data.orderId]);
    const recovered = await call("/api/orders/recover/verify", { method: "POST", body: { token: recoveryToken } });
    assert.equal(recovered.status, 200);
    const recoveredCookie = mergeCookies("", recovered.cookies);
    assert.deepEqual((await call("/api/orders", { cookie: recoveredCookie })).data.orders.map((order) => order.orderNumber), [otherOrder.data.orderNumber]);
    assert.equal((await call(`/api/orders/${placed.data.orderNumber}`, { cookie: recoveredCookie })).status, 404);

    const expiredEmail = `expired-${suffix}@example.com`;
    const expiredRegistration = await call("/api/customer/register", { method: "POST", body: { name: "Expired", email: expiredEmail } });
    assert.equal(expiredRegistration.status, 202);
    const expiredToken = latestVerificationToken();
    const expiredSession = await call("/api/customer/session", { cookie: mergeCookies("", expiredRegistration.cookies) });
    await pool.execute("UPDATE customer_verification_tokens SET expires_at = DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 1 SECOND) WHERE customer_id = ?", [expiredSession.data.customer.id]);
    assert.equal((await call("/api/customer/verification/confirm", { method: "POST", body: { token: expiredToken, password } })).status, 400);
    const [expiredCustomer] = await pool.execute("SELECT email, pending_email FROM customers WHERE id = ?", [expiredSession.data.customer.id]);
    assert.deepEqual([expiredCustomer[0].email, expiredCustomer[0].pending_email], [null, expiredEmail]);
  });

  await t.test("same-key replay, immutable conflict, and guest ownership", async () => {
    const item = await product(31000, 3);
    const cookie = await cartWithItem(item);
    const body = checkoutBody(item, `replay-${suffix}`);
    const placed = await call("/api/checkout", { method: "POST", cookie, body });
    assert.equal(placed.status, 201, JSON.stringify(placed.data));
    const replay = await call("/api/checkout", { method: "POST", cookie, body });
    assert.equal(replay.status, 200);
    assert.equal(replay.data.replayed, true);
    assert.equal(replay.data.orderId, placed.data.orderId);
    const changed = await call("/api/checkout", { method: "POST", cookie, body: { ...body, expectedTotalFils: item.priceFils + 1 } });
    assert.equal(changed.status, 409);
    assert.equal(changed.data.code, "IDEMPOTENCY_CONFLICT");
    const otherCookie = await cartWithItem(item);
    const other = await call("/api/checkout", { method: "POST", cookie: otherCookie, body });
    assert.equal(other.status, 409);
    assert.equal(other.data.code, "IDEMPOTENCY_CONFLICT");
    const [[attempt]] = await pool.query("SELECT id FROM checkout_idempotency_keys WHERE idempotency_key = ?", [body.idempotencyKey]);
    await pool.execute("DELETE FROM checkout_idempotency_keys WHERE id = ?", [attempt.id]);
    const removedAttemptRetry = await call("/api/checkout", { method: "POST", cookie, body });
    assert.equal(removedAttemptRetry.status, 409);
    assert.equal(removedAttemptRetry.data.code, "IDEMPOTENCY_EXPIRED");
    assert.equal(await stock(item), 2);
  });

  await t.test("same-key and different-key cart races deduct stock once", async () => {
    const sameKeyItem = await product(32000, 2);
    const sameKeyCookie = await cartWithItem(sameKeyItem);
    const sameKeyBody = checkoutBody(sameKeyItem, `same-race-${suffix}`);
    const sameKeyResults = await Promise.all([
      call("/api/checkout", { method: "POST", cookie: sameKeyCookie, body: sameKeyBody }),
      call("/api/checkout", { method: "POST", cookie: sameKeyCookie, body: sameKeyBody }),
    ]);
    assert.equal(sameKeyResults.filter((result) => result.status === 201).length, 1);
    assert.ok(sameKeyResults.every((result) => [200, 201, 409].includes(result.status)));
    if (sameKeyResults.some((result) => result.status === 409)) {
      const retry = await call("/api/checkout", { method: "POST", cookie: sameKeyCookie, body: sameKeyBody });
      assert.equal(retry.status, 200);
    }
    assert.equal(await stock(sameKeyItem), 1);

    const differentKeyItem = await product(33000, 2);
    const differentKeyCookie = await cartWithItem(differentKeyItem);
    const [first, second] = await Promise.all([
      call("/api/checkout", { method: "POST", cookie: differentKeyCookie, body: checkoutBody(differentKeyItem, `different-a-${suffix}`) }),
      call("/api/checkout", { method: "POST", cookie: differentKeyCookie, body: checkoutBody(differentKeyItem, `different-b-${suffix}`) }),
    ]);
    assert.equal([first, second].filter((result) => result.status === 201).length, 1);
    const conflict = [first, second].find((result) => result.status !== 201);
    assert.equal(conflict.status, 409);
    assert.equal(conflict.data.code, "CART_ALREADY_CHECKED_OUT");
    assert.equal(await stock(differentKeyItem), 1);
  });

  await t.test("buy-now replay, principal binding, rollback, and stale takeover", async () => {
    const buyNowItem = await product(34000, 2);
    const buyNowCookie = await (async () => {
      const result = await call("/api/cart");
      return mergeCookies("", result.cookies);
    })();
    const intent = await buyNowIntent(buyNowCookie, buyNowItem, 1);
    const buyNowCookieWithIntent = mergeCookies(buyNowCookie, intent.cookie);
    const buyNowBody = checkoutBody(buyNowItem, intent.attemptId, { buyNow: { productId: buyNowItem.id, quantity: 1, intent: intent.intent } });
    const bought = await call("/api/checkout", { method: "POST", cookie: buyNowCookieWithIntent, body: buyNowBody });
    assert.equal(bought.status, 201, JSON.stringify(bought.data));
    const boughtAgain = await call("/api/checkout", { method: "POST", cookie: buyNowCookieWithIntent, body: buyNowBody });
    assert.equal(boughtAgain.status, 200);
    assert.equal(await stock(buyNowItem), 1);
    const foreignCookie = await (async () => {
      const result = await call("/api/cart");
      return mergeCookies("", result.cookies);
    })();
    const foreignReplay = await call("/api/checkout", { method: "POST", cookie: foreignCookie, body: buyNowBody });
    assert.equal(foreignReplay.status, 409);
    assert.equal(foreignReplay.data.code, "INVALID_BUY_NOW_INTENT");
    const [attempts] = await pool.execute("SELECT mode, status, cart_id FROM checkout_idempotency_keys WHERE idempotency_key = ?", [buyNowBody.idempotencyKey]);
    assert.deepEqual([attempts[0].mode, attempts[0].status, Boolean(attempts[0].cart_id)], ["buy_now", "completed", true]);
    await pool.execute("DELETE FROM checkout_idempotency_keys WHERE idempotency_key = ?", [buyNowBody.idempotencyKey]);
    const expiredBuyNow = await call("/api/checkout", { method: "POST", cookie: buyNowCookieWithIntent, body: buyNowBody });
    assert.equal(expiredBuyNow.status, 409);
    assert.equal(expiredBuyNow.data.code, "IDEMPOTENCY_EXPIRED");
    assert.equal(await stock(buyNowItem), 1);

    const rollbackItem = await product(35000, 1);
    const rollbackCookie = await cartWithItem(rollbackItem);
    const rollbackBody = checkoutBody(rollbackItem, `rollback-${suffix}`, { expectedTotalFils: rollbackItem.priceFils + 1 });
    const failed = await call("/api/checkout", { method: "POST", cookie: rollbackCookie, body: rollbackBody });
    assert.equal(failed.status, 409);
    assert.equal(failed.data.code, "PRICE_CHANGED");
    const repeatedFailure = await call("/api/checkout", { method: "POST", cookie: rollbackCookie, body: rollbackBody });
    assert.equal(repeatedFailure.status, 409);
    assert.equal(repeatedFailure.data.code, "PRICE_CHANGED");
    const corrected = await call("/api/checkout", { method: "POST", cookie: rollbackCookie, body: checkoutBody(rollbackItem, `rollback-corrected-${suffix}`) });
    assert.equal(corrected.status, 201);
    assert.equal(await stock(rollbackItem), 0);

    const staleItem = await product(36000, 1);
    const staleCookie = await cartWithItem(staleItem);
    const cartToken = staleCookie.match(/(?:^|; )mini_cart=([^;]+)/)?.[1];
    const guestToken = staleCookie.match(/(?:^|; )mini_guest=([^;]+)/)?.[1];
    assert.ok(cartToken && guestToken);
    const [[cart]] = await pool.query("SELECT id FROM carts WHERE token_hash = ?", [hashToken(cartToken)]);
    const [[guest]] = await pool.query("SELECT id FROM guest_sessions WHERE token_hash = ?", [hashToken(guestToken)]);
    const staleBody = checkoutBody(staleItem, `stale-${suffix}`);
    const staleFingerprint = hashToken(JSON.stringify({ mode: "cart", name: staleBody.name, email: staleBody.email, phone: staleBody.phone, address: staleBody.address, expectedTotalFils: staleBody.expectedTotalFils, buyNow: null }));
    const [items] = await pool.execute("SELECT product_id, quantity FROM cart_items WHERE cart_id = ? ORDER BY product_id", [cart.id]);
    await pool.execute(
      `INSERT INTO checkout_idempotency_keys
       (idempotency_key, mode, guest_session_id, cart_id, immutable_fingerprint, items_snapshot, status, claim_hash, lease_until, expires_at)
       VALUES (?, 'cart', ?, ?, ?, ?, 'in_progress', ?, DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 1 SECOND), DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 1 DAY))`,
      [staleBody.idempotencyKey, guest.id, cart.id, staleFingerprint, JSON.stringify(items.map((item) => ({ productId: item.product_id, quantity: item.quantity }))), hashToken("stale-claim")],
    );
    const recovered = await call("/api/checkout", { method: "POST", cookie: staleCookie, body: staleBody });
    assert.equal(recovered.status, 201, JSON.stringify(recovered.data));
    assert.equal(await stock(staleItem), 0);
  });

  await t.test("buy-now uses only the selected quantity and preserves the rest of the cart", async () => {
    const item = await product(37000, 10);
    const unrelated = await product(18000, 10);
    const cookie = await cartWithItem(item, 4);
    const intent = await buyNowIntent(cookie, item, 2);
    await call("/api/cart/items", { method: "POST", cookie, body: { productId: unrelated.id, quantity: 3 } });
    const body = checkoutBody(item, intent.attemptId, {
      expectedTotalFils: item.priceFils * 2,
      buyNow: { productId: item.id, quantity: 2, intent: intent.intent },
    });
    const placed = await call("/api/checkout", { method: "POST", cookie: intent.cookie, body });
    assert.equal(placed.status, 201, JSON.stringify(placed.data));
    const [[ordered]] = await pool.execute("SELECT quantity FROM order_items WHERE order_id = ? AND product_id = ?", [placed.data.orderId, item.id]);
    assert.equal(ordered.quantity, 2);
    const token = cookie.match(/(?:^|; )mini_cart=([^;]+)/)?.[1];
    const [[cart]] = await pool.query("SELECT id FROM carts WHERE token_hash = ?", [hashToken(token)]);
    const [cartItems] = await pool.execute("SELECT product_id, quantity FROM cart_items WHERE cart_id = ? ORDER BY product_id", [cart.id]);
    assert.deepEqual(cartItems.map(({ product_id, quantity }) => [product_id, quantity]), [[item.id, 2], [unrelated.id, 3]].sort((a, b) => a[0] - b[0]));
    assert.equal(await stock(item), 8);
    assert.equal((await call("/api/checkout", { method: "POST", cookie: intent.cookie, body })).data.orderId, placed.data.orderId);
    assert.equal(await stock(item), 8);

    for (const selectedQuantity of [4, 6]) {
      const nextItem = await product(29000, 10);
      const nextCookie = await cartWithItem(nextItem, 4);
      const nextIntent = await buyNowIntent(nextCookie, nextItem, selectedQuantity);
      const nextBody = checkoutBody(nextItem, nextIntent.attemptId, {
        expectedTotalFils: nextItem.priceFils * selectedQuantity,
        buyNow: { productId: nextItem.id, quantity: selectedQuantity, intent: nextIntent.intent },
      });
      const [first, second] = await Promise.all([
        call("/api/checkout", { method: "POST", cookie: nextIntent.cookie, body: nextBody }),
        call("/api/checkout", { method: "POST", cookie: nextIntent.cookie, body: nextBody }),
      ]);
      assert.ok([201, 200, 409].includes(first.status) && [201, 200, 409].includes(second.status));
      const placedOrder = first.status === 201 || first.status === 200 ? first : second;
      assert.ok([201, 200].includes(placedOrder.status));
      const [[nextOrderItem]] = await pool.execute("SELECT quantity FROM order_items WHERE order_id = ? AND product_id = ?", [placedOrder.data.orderId, nextItem.id]);
      assert.equal(nextOrderItem.quantity, selectedQuantity);
      assert.equal(await stock(nextItem), 10 - selectedQuantity);
      const nextToken = nextCookie.match(/(?:^|; )mini_cart=([^;]+)/)?.[1];
      const [[nextCart]] = await pool.query("SELECT id FROM carts WHERE token_hash = ?", [hashToken(nextToken)]);
      const [remaining] = await pool.execute("SELECT quantity FROM cart_items WHERE cart_id = ? AND product_id = ?", [nextCart.id, nextItem.id]);
      assert.equal(remaining[0]?.quantity || 0, Math.max(4 - selectedQuantity, 0));
    }
  });

  await t.test("buy-now keeps same-product cart additions made after intent creation", async () => {
    const item = await product(24000, 10);
    const cookie = await cartWithItem(item, 4);
    const intent = await buyNowIntent(cookie, item, 2);
    await call("/api/cart/items", { method: "POST", cookie, body: { productId: item.id, quantity: 3 } });
    const body = checkoutBody(item, intent.attemptId, { expectedTotalFils: item.priceFils * 2, buyNow: { productId: item.id, quantity: 2, intent: intent.intent } });
    const placed = await call("/api/checkout", { method: "POST", cookie: intent.cookie, body });
    assert.equal(placed.status, 201, JSON.stringify(placed.data));
    const [[cart]] = await pool.query("SELECT id FROM carts WHERE token_hash = ?", [hashToken(intent.cookie.match(/(?:^|; )mini_cart=([^;]+)/)?.[1])]);
    const [[remaining]] = await pool.execute("SELECT quantity FROM cart_items WHERE cart_id = ? AND product_id = ?", [cart.id, item.id]);
    assert.equal(remaining.quantity, 5);
  });

  await t.test("buy-now intent is session-bound, selection-bound, single-key, and server-priced", async () => {
    const item = await product(27000, 5);
    const cart = await call("/api/cart");
    const cookie = mergeCookies("", cart.cookies);
    const intent = await buyNowIntent(cookie, item, 2);
    const body = checkoutBody(item, intent.attemptId, { expectedTotalFils: item.priceFils * 2, buyNow: { productId: item.id, quantity: 2, intent: intent.intent } });
    const tokenParts = intent.intent.split(".");
    tokenParts[1] = `${tokenParts[1][0] === "A" ? "B" : "A"}${tokenParts[1].slice(1)}`;
    const tampered = await call("/api/checkout", { method: "POST", cookie: intent.cookie, body: { ...body, buyNow: { ...body.buyNow, intent: tokenParts.join(".") } } });
    assert.equal(tampered.status, 400);
    assert.equal(tampered.data.code, "INVALID_BUY_NOW_INTENT");
    const changedQuantity = await call("/api/checkout", { method: "POST", cookie: intent.cookie, body: { ...body, buyNow: { ...body.buyNow, quantity: 3 } } });
    assert.equal(changedQuantity.status, 409);
    assert.equal(changedQuantity.data.code, "INVALID_BUY_NOW_INTENT");
    const changedKey = await call("/api/checkout", { method: "POST", cookie: intent.cookie, body: { ...body, idempotencyKey: `replay-${suffix}` } });
    assert.equal(changedKey.status, 409);
    assert.equal(changedKey.data.code, "INVALID_BUY_NOW_INTENT");
    const changedPrice = await call("/api/checkout", { method: "POST", cookie: intent.cookie, body: { ...body, expectedTotalFils: item.priceFils * 2 - 1 } });
    assert.equal(changedPrice.status, 409);
    assert.equal(changedPrice.data.code, "PRICE_CHANGED");
    assert.equal(await stock(item), 5);
  });

  await t.test("buy-now reports current stock and rejects invalid quantities", async () => {
    const item = await product(26000, 10);
    const cart = await call("/api/cart");
    const cookie = mergeCookies("", cart.cookies);
    const intent = await buyNowIntent(cookie, item, 4);
    await pool.execute("UPDATE products SET stock = 2 WHERE id = ?", [item.id]);
    const body = checkoutBody(item, intent.attemptId, { expectedTotalFils: item.priceFils * 4, buyNow: { productId: item.id, quantity: 4, intent: intent.intent } });
    const unavailable = await call("/api/checkout", { method: "POST", cookie: intent.cookie, body });
    assert.equal(unavailable.status, 409);
    assert.equal(unavailable.data.code, "INSUFFICIENT_STOCK");
    assert.match(unavailable.data.message, /Only 2 available/);
    assert.equal(await stock(item), 2);
    for (const quantity of [0, 1.5, 21]) {
      const invalid = await call("/api/checkout", { method: "POST", cookie: intent.cookie, body: { ...body, idempotencyKey: `invalid-${String(quantity).replace(".", "_")}-${suffix}`, buyNow: { productId: item.id, quantity, intent: intent.intent } } });
      assert.equal(invalid.status, 400);
    }
  });
});
