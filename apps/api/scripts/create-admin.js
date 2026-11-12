import { randomBytes, scryptSync } from "node:crypto";
import { pool } from "../src/db.js";

const useLocalDemo = !process.env.ADMIN_EMAIL && !process.env.ADMIN_PASSWORD && process.env.NODE_ENV === "development" && process.env.DB_NAME === "mini_store_dev";
const email = (process.env.ADMIN_EMAIL || (useLocalDemo ? "admin@mini-store.local" : "")).trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD || (useLocalDemo ? "MiniStoreDemo2026!" : "");
if (!email || !password || password.length < 12) {
  throw new Error(
    "Set ADMIN_EMAIL and ADMIN_PASSWORD (at least 12 characters), or use the local demo defaults in mini_store_dev",
  );
}

const salt = randomBytes(16).toString("hex");
const hash = scryptSync(password, salt, 64).toString("hex");
try {
  await pool.execute(
    "INSERT INTO admin_users (email, password_hash) VALUES (?, ?) ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)",
    [email, `${salt}:${hash}`],
  );
  await pool.execute(
    "DELETE s FROM admin_sessions s JOIN admin_users u ON u.id = s.admin_user_id WHERE u.email = ?",
    [email],
  );
  console.log(useLocalDemo ? `Local demo admin ready: ${email} / MiniStoreDemo2026!` : `Admin ready: ${email}`);
} finally {
  await pool.end();
}
