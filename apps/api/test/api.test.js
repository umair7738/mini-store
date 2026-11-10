import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import { app } from "../src/server.js";
import { pool } from "../src/db.js";

const suffix = randomBytes(5).toString("hex");
const variant = (key, sku, stock = 5, priceFils = 25000) => ({
  variantKey: key,
  label: key,
  attributes: { finish: key },
  sku: `${sku}-${suffix.toUpperCase()}`,
  stock,
  priceFils,
});
const product = (name, variants) => ({
  slug: `${name}-${suffix}`,
  name,
  description: "A durable product for a modern bathroom.",
  variants,
});

test("API works against the isolated MySQL test database", async (t) => {
  const [database] = await pool.query(
    "SELECT DATABASE() AS name, VERSION() AS version",
  );
  assert.equal(database[0].name, "mini_store_test");
  assert.match(database[0].version, /^8\.4\./);
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  });

  async function call(
    path,
    { method = "GET", body, cookie, csrf, orderToken } = {},
  ) {
    const headers = {};
    if (method !== "GET") headers.Origin = process.env.WEB_ORIGIN;
    if (body) headers["Content-Type"] = "application/json";
    if (cookie) headers.Cookie = cookie;
    if (csrf) headers["X-CSRF-Token"] = csrf;
    if (orderToken) headers["X-Order-Token"] = orderToken;
    const response = await fetch(base + path, {
      method,
      headers,
      ...(body && { body: JSON.stringify(body) }),
    });
    return {
      status: response.status,
      data: response.status === 204 ? null : await response.json(),
      cookie: response.headers.get("set-cookie")?.split(";")[0],
    };
  }

  const salt = randomBytes(16).toString("hex");
  const password = randomBytes(16).toString("base64url");
  await pool.execute(
    "INSERT INTO admin_users (email, password_hash) VALUES (?, ?)",
    [
      `test-${suffix}@example.com`,
      `${salt}:${scryptSync(password, salt, 64).toString("hex")}`,
    ],
  );
  const login = await call("/api/admin/login", {
    method: "POST",
    body: { email: `test-${suffix}@example.com`, password },
  });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  const adminCookie = login.cookie;
  const csrf = login.data.csrfToken;
  const admin = (path, method = "GET", body, token = csrf) =>
    call(path, { method, body, cookie: adminCookie, csrf: token });

  await t.test(
    "admin auth, CSRF, product and variant CRUD validation",
    async () => {
      assert.equal((await call("/api/admin/products")).status, 401);
      async function invalidLogin() {
        return fetch(base + "/api/admin/login", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: process.env.WEB_ORIGIN,
          },
          body: JSON.stringify({
            email: "nobody@example.com",
            password: "wrong",
          }),
        });
      }
      assert.equal((await invalidLogin()).status, 401);
      for (let attempt = 0; attempt < 4; attempt += 1)
        assert.equal((await invalidLogin()).status, 401);
      assert.equal((await invalidLogin()).status, 429);
      assert.equal(
        (
          await admin(
            "/api/admin/products",
            "POST",
            product("unauthorized", [variant("one", "AUTH")]),
            "wrong",
          )
        ).status,
        403,
      );
      const created = await admin(
        "/api/admin/products",
        "POST",
        product("ceramic-basin", [
          variant("white", "BASIN"),
          variant("black", "BASINB"),
        ]),
      );
      assert.equal(created.status, 201, JSON.stringify(created.data));
      const duplicateSlug = await admin(
        "/api/admin/products",
        "POST",
        product("ceramic-basin", [variant("other", "OTHER")]),
      );
      assert.equal(duplicateSlug.status, 409);
      assert.equal(duplicateSlug.data.field, "slug");
      const duplicateSku = await admin(
        "/api/admin/products",
        "POST",
        product("new-basin", [variant("white", "BASIN")]),
      );
      assert.equal(duplicateSku.status, 409);
      assert.equal(duplicateSku.data.field, "sku");
      const negative = await admin(
        "/api/admin/products",
        "POST",
        product("bad-basin", [variant("white", "BAD", 2, -1)]),
      );
      assert.equal(negative.status, 400);
      const listed = await call("/api/products");
      assert.ok(
        listed.data.products.some(
          (item) => item.slug === `ceramic-basin-${suffix}`,
        ),
      );
      const detail = await call(`/api/products/ceramic-basin-${suffix}`);
      assert.equal(detail.data.product.variants.length, 2);
      const updated = await admin(
        `/api/admin/products/${created.data.id}`,
        "PUT",
        { name: "Updated Ceramic Basin", description: "Updated description" },
      );
      assert.equal(updated.status, 200);
      const added = await admin(
        `/api/admin/products/${created.data.id}/variants`,
        "POST",
        variant("gold", "BASING"),
      );
      assert.equal(added.status, 201);
      assert.equal(
        (
          await admin(
            `/api/admin/products/variants/${added.data.id}`,
            "PUT",
            variant("gold", "BASING", 3, 30000),
          )
        ).status,
        200,
      );
      assert.equal(
        (await admin(`/api/admin/products/variants/${added.data.id}`, "DELETE"))
          .status,
        204,
      );
      assert.equal(
        (await admin(`/api/admin/products/${created.data.id}`, "DELETE"))
          .status,
        204,
      );
      assert.equal(
        (await call(`/api/products/ceramic-basin-${suffix}`)).status,
        404,
      );
    },
  );

  await t.test(
    "cart merges repeated additions and separates variants",
    async () => {
      const made = await admin(
        "/api/admin/products",
        "POST",
        product("cart-product", [
          variant("one", "CART1"),
          variant("two", "CART2"),
        ]),
      );
      assert.equal(made.status, 201);
      const detail = (await call(`/api/products/cart-product-${suffix}`)).data
        .product;
      const cart = await call("/api/cart");
      const cookie = cart.cookie;
      const add = (variantId, quantity) =>
        call("/api/cart/items", {
          method: "POST",
          cookie,
          body: { variantId, quantity },
        });
      assert.equal((await add(detail.variants[0].id, 1)).status, 201);
      assert.equal(
        (await add(detail.variants[0].id, 1)).data.items[0].quantity,
        2,
      );
      assert.equal((await add(detail.variants[1].id, 1)).data.items.length, 2);
      assert.equal(
        (
          await call(`/api/cart/items/${detail.variants[0].id}`, {
            method: "PATCH",
            cookie,
            body: { quantity: 0 },
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await call(`/api/cart/items/${detail.variants[0].id}`, {
            method: "PATCH",
            cookie,
            body: { quantity: 1 },
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await call(`/api/cart/items/${detail.variants[1].id}`, {
            method: "DELETE",
            cookie,
          })
        ).data.items.length,
        1,
      );
      assert.equal((await call("/api/cart", { cookie })).data.totalFils, 25000);
    },
  );

  await t.test(
    "checkout uses server prices, keeps snapshots, and blocks duplicate orders",
    async () => {
      const made = await admin(
        "/api/admin/products",
        "POST",
        product("checkout-product", [variant("white", "CHECK", 3, 40000)]),
      );
      const productId = made.data.id;
      const item = (await call(`/api/products/checkout-product-${suffix}`)).data
        .product.variants[0];
      const cart = await call("/api/cart");
      const cookie = cart.cookie;
      await call("/api/cart/items", {
        method: "POST",
        cookie,
        body: { variantId: item.id, quantity: 1 },
      });
      const payload = {
        name: "Test Buyer",
        email: "buyer@example.com",
        phone: "+971 50 123 4567",
        address: "123 Main Street, Dubai",
        expectedTotalFils: 40000,
        idempotencyKey: `checkout-${suffix}`,
      };
      const invalidPhone = await call("/api/checkout", {
        method: "POST",
        cookie,
        body: { ...payload, phone: "not-a-phone" },
      });
      assert.equal(invalidPhone.status, 400);
      const missingPhone = await call("/api/checkout", {
        method: "POST",
        cookie,
        body: { ...payload, phone: undefined },
      });
      assert.equal(missingPhone.status, 400);
      const manipulated = await call("/api/checkout", {
        method: "POST",
        cookie,
        body: { ...payload, expectedTotalFils: 1 },
      });
      assert.equal(manipulated.status, 409);
      assert.equal(manipulated.data.code, "PRICE_CHANGED");
      const updatedVariant = variant("white", "CHECK", 3, 45000);
      assert.equal(
        (
          await admin(
            `/api/admin/products/variants/${item.id}`,
            "PUT",
            updatedVariant,
          )
        ).status,
        200,
      );
      assert.equal(
        (await call("/api/checkout", { method: "POST", cookie, body: payload }))
          .data.code,
        "PRICE_CHANGED",
      );
      const result = await call("/api/checkout", {
        method: "POST",
        cookie,
        body: { ...payload, expectedTotalFils: 45000 },
      });
      assert.equal(result.status, 201, JSON.stringify(result.data));
      assert.equal(result.data.totalFils, 45000);
      const replay = await call("/api/checkout", {
        method: "POST",
        cookie,
        body: { ...payload, expectedTotalFils: 45000 },
      });
      assert.equal(replay.status, 200);
      assert.equal(replay.data.replayed, true);
      assert.equal(replay.data.orderId, result.data.orderId);
      const conflict = await call("/api/checkout", {
        method: "POST",
        cookie,
        body: { ...payload, name: "Different Buyer", expectedTotalFils: 45000 },
      });
      assert.equal(conflict.status, 409);
      assert.equal(conflict.data.code, "IDEMPOTENCY_CONFLICT");
      assert.equal(
        (await call(`/api/orders/${result.data.orderId}`)).status,
        404,
      );
      assert.equal(
        (
          await call(`/api/orders/${result.data.orderId}`, {
            orderToken: "bad",
          })
        ).status,
        404,
      );
      assert.equal(
        (
          await call(`/api/orders/${result.data.orderId}`, {
            orderToken: result.data.confirmationToken,
          })
        ).data.order.items[0].unitPriceFils,
        45000,
      );
      assert.equal(
        (
          await call(`/api/orders/${result.data.orderId}`, {
            orderToken: result.data.confirmationToken,
          })
        ).data.order.phone,
        "+971 50 123 4567",
      );
      await admin(`/api/admin/products/${productId}`, "PUT", {
        name: "Renamed Product",
        description: "Later description",
      });
      await admin(
        `/api/admin/products/variants/${item.id}`,
        "PUT",
        variant("white", "CHECK", 2, 50000),
      );
      const confirmation = await call(`/api/orders/${result.data.orderId}`, {
        orderToken: result.data.confirmationToken,
      });
      assert.equal(
        confirmation.data.order.items[0].productName,
        "checkout-product",
      );
      assert.equal(confirmation.data.order.items[0].unitPriceFils, 45000);
      const [stock] = await pool.execute(
        "SELECT stock FROM product_variants WHERE id = ?",
        [item.id],
      );
      assert.equal(stock[0].stock, 2);
      const [orders] = await pool.execute(
        "SELECT COUNT(*) AS count FROM orders WHERE cart_id = (SELECT cart_id FROM orders WHERE id = ?)",
        [result.data.orderId],
      );
      assert.equal(orders[0].count, 1);
      await pool.execute(
        "UPDATE orders SET confirmation_expires_at = DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 1 SECOND) WHERE id = ?",
        [result.data.orderId],
      );
      assert.equal(
        (
          await call(`/api/orders/${result.data.orderId}`, {
            orderToken: result.data.confirmationToken,
          })
        ).status,
        404,
      );
    },
  );

  await t.test(
    "failed multi-item checkout rolls back and concurrent checkout cannot oversell",
    async () => {
      await admin(
        "/api/admin/products",
        "POST",
        product("stock-product", [
          variant("a", "STOCKA", 2, 10000),
          variant("b", "STOCKB", 1, 20000),
        ]),
      );
      const items = (await call(`/api/products/stock-product-${suffix}`)).data
        .product.variants;
      const cart = await call("/api/cart");
      for (const item of items)
        await call("/api/cart/items", {
          method: "POST",
          cookie: cart.cookie,
          body: { variantId: item.id, quantity: 1 },
        });
      await admin(
        `/api/admin/products/variants/${items[1].id}`,
        "PUT",
        variant("b", "STOCKB", 0, 20000),
      );
      const details = {
        name: "Stock Buyer",
        email: "stock@example.com",
        phone: "+971 50 765 4321",
        address: "123 Main Street, Dubai",
        expectedTotalFils: 30000,
        idempotencyKey: `rollback-${suffix}`,
      };
      const failed = await call("/api/checkout", {
        method: "POST",
        cookie: cart.cookie,
        body: details,
      });
      assert.equal(failed.status, 409);
      assert.equal(failed.data.code, "INSUFFICIENT_STOCK");
      const [remaining] = await pool.execute(
        "SELECT stock FROM product_variants WHERE id = ?",
        [items[0].id],
      );
      assert.equal(remaining[0].stock, 2);
      const [count] = await pool.execute(
        "SELECT COUNT(*) AS count FROM orders WHERE cart_id = (SELECT id FROM carts WHERE token_hash = UNHEX(SHA2(?, 256)))",
        [cart.cookie.split("=")[1]],
      );
      assert.equal(count[0].count, 0);

      const first = await call("/api/cart");
      const second = await call("/api/cart");
      await call("/api/cart/items", {
        method: "POST",
        cookie: first.cookie,
        body: { variantId: items[1].id, quantity: 1 },
      }).then((result) => assert.equal(result.status, 409));
      await admin(
        `/api/admin/products/variants/${items[1].id}`,
        "PUT",
        variant("b", "STOCKB", 1, 20000),
      );
      await call("/api/cart/items", {
        method: "POST",
        cookie: first.cookie,
        body: { variantId: items[1].id, quantity: 1 },
      });
      await call("/api/cart/items", {
        method: "POST",
        cookie: second.cookie,
        body: { variantId: items[1].id, quantity: 1 },
      });
      const checks = await Promise.all(
        [first, second].map((each, index) =>
          call("/api/checkout", {
            method: "POST",
            cookie: each.cookie,
            body: {
              ...details,
              expectedTotalFils: 20000,
              idempotencyKey: `concurrent-${suffix}-${index}`,
            },
          }),
        ),
      );
      assert.deepEqual(
        checks.map((result) => result.status).sort(),
        [201, 409],
      );
      const [final] = await pool.execute(
        "SELECT stock FROM product_variants WHERE id = ?",
        [items[1].id],
      );
      assert.equal(final[0].stock, 0);
    },
  );

  await t.test(
    "admin order tracking, cancellation, and manual refunds",
    async () => {
      await admin(
        "/api/admin/products",
        "POST",
        product("order-operations", [variant("white", "OPS", 2, 15000)]),
      );
      const item = (await call(`/api/products/order-operations-${suffix}`)).data
        .product.variants[0];
      async function placeOrder() {
        const cart = await call("/api/cart");
        await call("/api/cart/items", {
          method: "POST",
          cookie: cart.cookie,
          body: { variantId: item.id, quantity: 1 },
        });
        return call("/api/checkout", {
          method: "POST",
          cookie: cart.cookie,
          body: {
            name: "Order Buyer",
            email: "orders@example.com",
            phone: "+971 50 555 0199",
            address: "123 Main Street, Dubai",
            expectedTotalFils: 15000,
            idempotencyKey: `operations-${suffix}-${Date.now()}`,
          },
        });
      }
      const first = await placeOrder();
      assert.equal(first.status, 201);
      const path = `/api/admin/orders/${first.data.orderId}`;
      assert.equal((await call("/api/admin/orders")).status, 401);
      assert.equal((await admin(path)).data.order.status, "placed");
      assert.equal((await admin(path)).data.order.phone, "+971 50 555 0199");
      assert.equal(
        (
          await admin(
            `${path}/status`,
            "PATCH",
            { status: "processing" },
            "bad",
          )
        ).status,
        403,
      );
      assert.equal(
        (await admin(`${path}/status`, "PATCH", { status: "unknown" })).status,
        400,
      );
      assert.equal(
        (await admin(`${path}/status`, "PATCH", { status: "processing" }))
          .status,
        200,
      );
      assert.equal(
        (await admin(`${path}/status`, "PATCH", { status: "cancelled" }))
          .status,
        200,
      );
      assert.equal(
        (await admin(`${path}/status`, "PATCH", { status: "cancelled" }))
          .status,
        200,
      );
      assert.equal(
        (await admin(`${path}/status`, "PATCH", { status: "delivered" }))
          .status,
        409,
      );
      const [restocked] = await pool.execute(
        "SELECT stock FROM product_variants WHERE id = ?",
        [item.id],
      );
      assert.equal(restocked[0].stock, 2);
      assert.equal(
        (await admin(`${path}/refund`, "POST", { note: "short" })).status,
        400,
      );
      assert.equal(
        (
          await admin(`${path}/refund`, "POST", {
            note: "Manual refund requested",
          })
        ).status,
        201,
      );
      assert.equal(
        (await admin(`${path}/refund`, "POST", { note: "Another request" }))
          .status,
        409,
      );
      assert.equal(
        (await admin(`${path}/refund`, "PATCH", { status: "completed" }))
          .status,
        200,
      );
      assert.equal(
        (await admin(`${path}/refund`, "PATCH", { status: "completed" }))
          .status,
        409,
      );
      assert.equal((await admin(path)).data.order.refundStatus, "completed");

      const second = await placeOrder();
      assert.equal(second.status, 201);
      const secondPath = `/api/admin/orders/${second.data.orderId}`;
      assert.equal(
        (await admin(`${secondPath}/status`, "PATCH", { status: "processing" }))
          .status,
        200,
      );
      assert.equal(
        (await admin(`${secondPath}/status`, "PATCH", { status: "shipped" }))
          .status,
        400,
      );
      assert.equal(
        (
          await admin(`${secondPath}/status`, "PATCH", {
            status: "shipped",
            carrier: "Aramex",
            trackingNumber: "ARX-12345",
            trackingUrl: "https://tracking.example/ARX-12345",
          })
        ).status,
        200,
      );
      assert.equal(
        (await admin(`${secondPath}/status`, "PATCH", { status: "delivered" }))
          .status,
        200,
      );
      assert.equal(
        (await admin(`${secondPath}/status`, "PATCH", { status: "cancelled" }))
          .status,
        409,
      );
      const delivered = await admin(secondPath);
      assert.equal(delivered.data.order.items[0].sku, item.sku);
      assert.equal(delivered.data.order.carrier, "Aramex");
      assert.equal(delivered.data.order.trackingNumber, "ARX-12345");
      assert.equal(delivered.data.order.events.at(-1).type, "delivered");
      assert.equal(
        (
          await call(`/api/orders/${second.data.orderId}`, {
            orderToken: second.data.confirmationToken,
          })
        ).data.order.trackingNumber,
        "ARX-12345",
      );
      assert.ok(
        (await admin("/api/admin/orders")).data.orders.some(
          (order) => order.id === second.data.orderId,
        ),
      );
    },
  );

  assert.equal((await admin("/api/admin/logout", "POST")).status, 204);
  assert.equal((await admin("/api/admin/products")).status, 401);
});
