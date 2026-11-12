import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { pool } from "../src/db.js";
import { validateAttemptPrincipal } from "../src/checkout.js";

test("checkout idempotency migration preserves ownership constraints", async (t) => {
  t.after(() => pool.end());

  const [ledger] = await pool.execute(
    "SELECT version FROM schema_migrations WHERE version = ?",
    ["20261112-checkout-idempotency"],
  );
  assert.equal(ledger.length, 1);

  const [columns] = await pool.execute(
    `SELECT COLUMN_NAME, IS_NULLABLE
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'checkout_idempotency_keys'`,
  );
  assert.equal(columns.find((column) => column.COLUMN_NAME === "customer_id").IS_NULLABLE, "YES");
  assert.equal(columns.find((column) => column.COLUMN_NAME === "guest_session_id").IS_NULLABLE, "YES");
  assert.equal(columns.find((column) => column.COLUMN_NAME === "status").IS_NULLABLE, "NO");

  const [foreignKeys] = await pool.execute(
    `SELECT REFERENCED_TABLE_NAME, DELETE_RULE, UPDATE_RULE
     FROM information_schema.REFERENTIAL_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND CONSTRAINT_NAME LIKE 'fk_checkout_idempotency_%'
     ORDER BY CONSTRAINT_NAME`,
  );
  assert.deepEqual(
    foreignKeys.map((key) => [key.REFERENCED_TABLE_NAME, key.DELETE_RULE, key.UPDATE_RULE]),
    [
      ["carts", "RESTRICT", "RESTRICT"],
      ["customers", "RESTRICT", "RESTRICT"],
      ["guest_sessions", "RESTRICT", "RESTRICT"],
      ["orders", "RESTRICT", "RESTRICT"],
    ],
  );

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [customers] = await connection.execute("SELECT id FROM customers ORDER BY id LIMIT 1");
    assert.ok(customers.length, "test database needs a customer row");
    const key = `migration-${randomBytes(8).toString("hex")}`;
    await connection.execute(
      `INSERT INTO checkout_idempotency_keys
       (idempotency_key, mode, customer_id, status, expires_at)
       VALUES (?, 'cart', ?, 'in_progress', DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 1 DAY))`,
      [key, customers[0].id],
    );
    const [stored] = await connection.execute(
      "SELECT customer_id, guest_session_id FROM checkout_idempotency_keys WHERE idempotency_key = ?",
      [key],
    );
    assert.equal(stored[0].customer_id, customers[0].id);
    assert.equal(stored[0].guest_session_id, null);
    const guestTokenHash = randomBytes(32);
    const [guestResult] = await connection.execute(
      "INSERT INTO guest_sessions (token_hash, expires_at) VALUES (?, DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 1 DAY))",
      [guestTokenHash],
    );
    const guestKey = `migration-guest-${randomBytes(8).toString("hex")}`;
    await connection.execute(
      `INSERT INTO checkout_idempotency_keys
       (idempotency_key, mode, guest_session_id, status, expires_at)
       VALUES (?, 'cart', ?, 'in_progress', DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 1 DAY))`,
      [guestKey, guestResult.insertId],
    );
    const legacyKey = `migration-legacy-${randomBytes(8).toString("hex")}`;
    await connection.execute(
      `INSERT INTO checkout_idempotency_keys
       (idempotency_key, mode, status, expires_at)
       VALUES (?, 'legacy', 'legacy', DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 1 DAY))`,
      [legacyKey],
    );
    await connection.execute("UPDATE guest_sessions SET revoked_at = UTC_TIMESTAMP(6) WHERE id = ?", [guestResult.insertId]);
    await assert.rejects(
      connection.execute("DELETE FROM guest_sessions WHERE id = ?", [guestResult.insertId]),
      (error) => error.code === "ER_ROW_IS_REFERENCED_2",
    );
    await connection.rollback();
  } finally {
    connection.release();
  }

  const invalidConnection = await pool.getConnection();
  try {
    await invalidConnection.beginTransaction();
    await assert.rejects(
      invalidConnection.execute(
        `INSERT INTO checkout_idempotency_keys
         (idempotency_key, mode, customer_id, status, expires_at)
         VALUES (?, 'cart', 4294967295, 'in_progress', DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 1 DAY))`,
        [`invalid-fk-${randomBytes(8).toString("hex")}`],
      ),
      (error) => error.code === "ER_NO_REFERENCED_ROW_2",
    );
    await invalidConnection.rollback();
  } finally {
    invalidConnection.release();
  }

  assert.doesNotThrow(() => validateAttemptPrincipal({ customerId: 1, guestSessionId: null }));
  assert.doesNotThrow(() => validateAttemptPrincipal({ customerId: null, guestSessionId: 1 }));
  assert.doesNotThrow(() => validateAttemptPrincipal({ customerId: null, guestSessionId: null, status: "legacy" }));
  for (const principal of [
    { customerId: 1, guestSessionId: 1 },
    { customerId: null, guestSessionId: null },
    { customerId: 0, guestSessionId: null },
  ]) assert.throws(() => validateAttemptPrincipal(principal), { code: "INVALID_IDEMPOTENCY_PRINCIPAL" });
});
