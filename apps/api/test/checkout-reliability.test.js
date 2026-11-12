import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

process.env.RATE_LIMIT_CHECKOUT_PER_MINUTE = "100";
process.env.RATE_LIMIT_CHECKOUT_SESSION_PER_MINUTE = "100";
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
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await pool.end(); });

  async function call(path, { method = "GET", body, cookie } = {}) {
    const headers = {};
    if (method !== "GET") headers.Origin = process.env.WEB_ORIGIN;
    if (body) headers["Content-Type"] = "application/json";
    if (cookie) headers.Cookie = cookie;
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
    const buyNowBody = checkoutBody(buyNowItem, `buy-now-${suffix}`, { buyNow: { productId: buyNowItem.id, quantity: 1 } });
    const bought = await call("/api/checkout", { method: "POST", cookie: buyNowCookie, body: buyNowBody });
    assert.equal(bought.status, 201, JSON.stringify(bought.data));
    const boughtAgain = await call("/api/checkout", { method: "POST", cookie: buyNowCookie, body: buyNowBody });
    assert.equal(boughtAgain.status, 200);
    assert.equal(await stock(buyNowItem), 1);
    const foreignCookie = await (async () => {
      const result = await call("/api/cart");
      return mergeCookies("", result.cookies);
    })();
    const foreignReplay = await call("/api/checkout", { method: "POST", cookie: foreignCookie, body: buyNowBody });
    assert.equal(foreignReplay.status, 409);
    assert.equal(foreignReplay.data.code, "IDEMPOTENCY_CONFLICT");
    const [attempts] = await pool.execute("SELECT mode, status, cart_id FROM checkout_idempotency_keys WHERE idempotency_key = ?", [buyNowBody.idempotencyKey]);
    assert.deepEqual([attempts[0].mode, attempts[0].status, Boolean(attempts[0].cart_id)], ["buy_now", "completed", true]);
    await pool.execute("DELETE FROM checkout_idempotency_keys WHERE idempotency_key = ?", [buyNowBody.idempotencyKey]);
    const expiredBuyNow = await call("/api/checkout", { method: "POST", cookie: buyNowCookie, body: buyNowBody });
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
});
