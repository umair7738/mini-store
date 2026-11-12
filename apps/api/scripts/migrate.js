import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { pool } from "../src/db.js";

const sql = await readFile(
  new URL("../db/schema.sql", import.meta.url),
  "utf8",
);
const connection = await pool.getConnection();
try {
  // The schema is a trusted local file; ordinary application queries stay parameterized.
  for (const statement of sql
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)) {
    await connection.query(statement);
  }
  const [customerIdColumn] = await connection.execute(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'customer_id'",
  );
  if (!customerIdColumn.length) await connection.query("ALTER TABLE orders ADD COLUMN customer_id INT UNSIGNED NULL AFTER public_id");
  const [ordersCustomerFk] = await connection.execute(
    "SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND CONSTRAINT_NAME = 'fk_orders_customer' AND CONSTRAINT_TYPE = 'FOREIGN KEY'",
  );
  if (!ordersCustomerFk.length) await connection.query("ALTER TABLE orders ADD CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL");
  const [columns] = await connection.execute(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'status'",
  );
  if (!columns.length) {
    const migration = await readFile(
      new URL("../db/order-operations.sql", import.meta.url),
      "utf8",
    );
    await connection.query(migration);
  }
  const [tracking] = await connection.execute(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'tracking_number'",
  );
  if (!tracking.length) {
    const migration = await readFile(
      new URL("../db/order-tracking.sql", import.meta.url),
      "utf8",
    );
    for (const statement of migration
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)) {
      await connection.query(statement);
    }
  }
  const [phoneColumn] = await connection.execute(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'customer_phone'",
  );
  const [idempotencyColumn] = await connection.execute(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'idempotency_key'",
  );
  const [idempotencyIndex] = await connection.execute(
    "SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND INDEX_NAME = 'uq_orders_idempotency_key'",
  );
  const checkoutMigration = await readFile(
    new URL("../db/checkout-reliability.sql", import.meta.url),
    "utf8",
  );
  let hasPhoneColumn = phoneColumn.length > 0;
  let hasIdempotencyColumn = idempotencyColumn.length > 0;
  let hasIdempotencyIndex = idempotencyIndex.length > 0;
  for (const statement of checkoutMigration
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)) {
    if (statement.includes("customer_phone")) {
      if (!hasPhoneColumn) {
        await connection.query(statement);
        hasPhoneColumn = true;
      }
    } else if (statement.includes("idempotency_key") && statement.includes("ADD COLUMN")) {
      if (!hasIdempotencyColumn) {
        await connection.query(statement);
        hasIdempotencyColumn = true;
      }
    } else if (statement.includes("uq_orders_idempotency_key")) {
      if (!hasIdempotencyIndex) {
        await connection.query(statement);
        hasIdempotencyIndex = true;
      }
    }
  }
  const [publicIdColumn] = await connection.execute(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'public_id'",
  );
  if (!publicIdColumn.length) {
    const publicIdMigration = await readFile(
      new URL("../db/order-public-id.sql", import.meta.url),
      "utf8",
    );
    for (const statement of publicIdMigration
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)) {
      await connection.query(statement);
    }
  }
  const [missingPublicIds] = await connection.execute(
    "SELECT id FROM orders WHERE public_id IS NULL ORDER BY id",
  );
  for (const row of missingPublicIds) {
    await connection.execute(
      "UPDATE orders SET public_id = ? WHERE id = ? AND public_id IS NULL",
      [randomUUID(), row.id],
    );
  }
  const [publicIdIndex] = await connection.execute(
    "SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND INDEX_NAME = 'uq_orders_public_id'",
  );
  if (!publicIdIndex.length) {
    await connection.query(
      "ALTER TABLE orders ADD UNIQUE INDEX uq_orders_public_id (public_id)",
    );
  }
  const [remainingPublicIds] = await connection.execute(
    "SELECT COUNT(*) AS count FROM orders WHERE public_id IS NULL",
  );
  if (remainingPublicIds[0].count === 0) {
    await connection.query(
      "ALTER TABLE orders MODIFY public_id CHAR(36) NOT NULL",
    );
  }
  async function applyVersionedMigration(version, filename) {
    const [applied] = await connection.execute(
      "SELECT version FROM schema_migrations WHERE version = ?",
      [version],
    );
    if (applied.length) return;
    const migration = await readFile(new URL(`../db/${filename}`, import.meta.url), "utf8");
    for (const statement of migration
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)) {
      await connection.query(statement);
    }
    const [legacyOrders] = await connection.execute(
      `SELECT o.id, o.idempotency_key, o.customer_id, o.cart_id,
              (SELECT gso.guest_session_id FROM guest_session_orders gso
               WHERE gso.order_id = o.id ORDER BY gso.guest_session_id LIMIT 1) AS guest_session_id
       FROM orders o
       WHERE o.idempotency_key IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM checkout_idempotency_keys c
           WHERE c.idempotency_key = o.idempotency_key
         )`,
    );
    for (const order of legacyOrders) {
      await connection.execute(
        `INSERT IGNORE INTO checkout_idempotency_keys
           (idempotency_key, mode, customer_id, guest_session_id, cart_id, order_id, status, expires_at)
         VALUES (?, 'legacy', ?, ?, ?, ?, 'legacy', DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 7 DAY))`,
        [
          order.idempotency_key,
          order.customer_id,
          order.customer_id ? null : order.guest_session_id,
          order.cart_id,
          order.id,
        ],
      );
    }
    await connection.execute(
      "INSERT INTO schema_migrations (version) VALUES (?)",
      [version],
    );
  }
  await applyVersionedMigration("20261112-checkout-idempotency", "checkout-idempotency.sql");
  const [productSkuColumn] = await connection.execute(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'sku'",
  );
  const [legacyVariantTable] = await connection.execute(
    "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_variants'",
  );
  const [legacyCartColumn] = await connection.execute(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cart_items' AND COLUMN_NAME = 'variant_id'",
  );
  if (legacyVariantTable.length && legacyCartColumn.length) {
    const productMigration = await readFile(
      new URL("../db/products-only.sql", import.meta.url),
      "utf8",
    );
    const statements = productMigration.split(";").map((part) => part.trim()).filter(Boolean);
    for (const statement of statements) {
      if (productSkuColumn.length && statement.startsWith("ALTER TABLE products\n  ADD COLUMN sku")) continue;
      if (statement.includes("DROP FOREIGN KEY fk_cart_items_variant")) {
        const [constraint] = await connection.execute(
          "SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cart_items' AND CONSTRAINT_NAME = 'fk_cart_items_variant' AND CONSTRAINT_TYPE = 'FOREIGN KEY'",
        );
        if (!constraint.length) continue;
      }
      if (statement.includes("ADD INDEX idx_cart_items_cart")) {
        const [index] = await connection.execute(
          "SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cart_items' AND INDEX_NAME = 'idx_cart_items_cart'",
        );
        if (index.length) continue;
      }
      await connection.query(statement);
    }
  }
  const [imagesColumn] = await connection.execute(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'images'",
  );
  if (!imagesColumn.length) await connection.query("ALTER TABLE products ADD COLUMN images JSON NULL AFTER image_url");
  const [imageColumn] = await connection.execute(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'image_url'",
  );
  const [quantityConstraint] = await connection.execute(
    "SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cart_items' AND CONSTRAINT_NAME = 'chk_cart_quantity_phase2'",
  );
  const [oversizedCartItems] = await connection.execute(
    "SELECT COUNT(*) AS count FROM cart_items WHERE quantity > 20",
  );
  const imageQuantityMigration = await readFile(
    new URL("../db/product-images-quantity.sql", import.meta.url),
    "utf8",
  );
  let hasImageColumn = imageColumn.length > 0;
  let hasQuantityConstraint = quantityConstraint.length > 0;
  for (const statement of imageQuantityMigration
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)) {
    if (statement.includes("image_url")) {
      if (!hasImageColumn) {
        await connection.query(statement);
        hasImageColumn = true;
      }
    } else if (statement.includes("chk_cart_quantity_phase2")) {
      if (!hasQuantityConstraint && oversizedCartItems[0].count === 0) {
        await connection.query(statement);
        hasQuantityConstraint = true;
      }
    }
  }
  console.log("Schema ready");
} finally {
  connection.release();
  await pool.end();
}
