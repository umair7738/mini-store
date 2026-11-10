import { readFile } from "node:fs/promises";
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
  console.log("Schema ready");
} finally {
  connection.release();
  await pool.end();
}
