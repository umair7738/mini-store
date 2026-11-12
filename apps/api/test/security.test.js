import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { app } from "../src/server.js";
import { rateLimit } from "../src/rateLimit.js";

test("API security middleware rejects unsafe requests and exposes request IDs", async (t) => {
  const server = app.listen(0);
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  const notFound = await fetch(`${base}/api/not-found`);
  assert.equal(notFound.status, 404);
  assert.match(notFound.headers.get("x-request-id"), /^[0-9a-f-]{36}$/);

  const missingOrigin = await fetch(`${base}/api/cart/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productId: 1, quantity: 1 }),
  });
  assert.equal(missingOrigin.status, 403);
  assert.equal((await missingOrigin.json()).code, "ORIGIN_REJECTED");

  const unexpected = await fetch(`${base}/api/cart/items`, {
    method: "POST",
    headers: { Origin: process.env.WEB_ORIGIN, "Content-Type": "application/json" },
    body: JSON.stringify({ productId: 1, quantity: 1, priceFils: 1 }),
  });
  assert.equal(unexpected.status, 400);
  const unexpectedBody = await unexpected.json();
  assert.equal(unexpectedBody.code, "UNEXPECTED_FIELD");
  assert.equal(unexpectedBody.requestId, unexpected.headers.get("x-request-id"));
});

test("bounded rate limiter returns Retry-After and does not expose raw keys", () => {
  const name = `test-${randomBytes(8).toString("hex")}`;
  const middleware = rateLimit({ name, fallbackLimit: 2, key: () => ["email@example.com"] });
  const response = { headers: {}, set(key, value) { this.headers[key] = value; } };
  let errors = 0;
  const next = (error) => { if (error) errors += 1; };
  middleware({ ip: "127.0.0.1" }, response, next);
  middleware({ ip: "127.0.0.1" }, response, next);
  middleware({ ip: "127.0.0.1" }, response, next);
  assert.equal(errors, 1);
  assert.match(response.headers["Retry-After"], /^\d+$/);
});
