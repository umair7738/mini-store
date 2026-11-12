import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { pool } from "./db.js";
import { hashToken } from "./auth.js";
import { HttpError, email, object, phone, string, id } from "./validation.js";
import { clientAddress, identifierHash, rateLimit } from "./rateLimit.js";

export const customerRouter = Router();
const cookieName = "mini_customer";
const cookieOptions = { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/api", maxAge: 30 * 86400000 };
const dummyPasswordHash = passwordHash("not-a-real-customer-password");

function csrf(token) { return createHmac("sha256", process.env.CSRF_SECRET).update(`customer:${token}`).digest("hex"); }
function passwordHash(password) { const salt = randomBytes(16).toString("hex"); return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`; }
function passwordMatches(password, stored) {
  const [salt, hex] = stored.split(":");
  const expected = Buffer.from(hex || "", "hex");
  return expected.length === 64 && timingSafeEqual(scryptSync(password, salt, 64), expected);
}
function setSession(res, token) { res.cookie(cookieName, token, cookieOptions); }

export async function getCustomer(req, db = pool) {
  const token = req.cookies?.[cookieName];
  if (!token) return null;
  const [rows] = await db.execute(
    `SELECT c.id, c.email, c.full_name AS name, c.phone, s.token_hash
     FROM customer_sessions s JOIN customers c ON c.id = s.customer_id
     WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP(6)`, [hashToken(token)],
  );
  return rows[0] || null;
}

export async function requireCustomer(req, res, next) {
  try {
    const customer = await getCustomer(req);
    if (!customer) throw new HttpError(401, "CUSTOMER_LOGIN_REQUIRED", "Sign in to access your account");
    req.customer = customer;
    req.customerToken = req.cookies[cookieName];
    next();
  } catch (error) { next(error); }
}

export function requireCustomerCsrf(req, res, next) {
  const expected = csrf(req.customerToken);
  const actual = Buffer.from(req.get("X-CSRF-Token") || "");
  if (actual.length !== expected.length || !timingSafeEqual(actual, Buffer.from(expected))) return next(new HttpError(403, "CSRF_REJECTED", "Invalid CSRF token"));
  next();
}

async function startSession(customer, res) {
  const token = randomBytes(32).toString("base64url");
  await pool.execute("INSERT INTO customer_sessions (token_hash, customer_id, expires_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 30 DAY))", [hashToken(token), customer.id]);
  setSession(res, token);
  return { id: customer.id, email: customer.email, name: customer.full_name, phone: customer.phone, csrfToken: csrf(token) };
}

customerRouter.post(
  "/register",
  rateLimit({ name: "customer-auth-ip", limitEnv: "RATE_LIMIT_CUSTOMER_AUTH_PER_MINUTE", fallbackLimit: 8, key: (req) => [clientAddress(req)], code: "RATE_LIMITED", message: "Too many attempts. Try again shortly." }),
  rateLimit({ name: "customer-auth-account", limitEnv: "RATE_LIMIT_CUSTOMER_AUTH_PER_ACCOUNT_PER_MINUTE", fallbackLimit: 5, key: (req) => [clientAddress(req), identifierHash(req.body?.email)], code: "RATE_LIMITED", message: "Too many attempts. Try again shortly." }),
  async (req, res) => {
  object(req.body, ["name", "email", "phone", "password"]);
  const address = email(req.body.email);
  const name = string(req.body.name, "Name");
  const password = string(req.body.password, "Password", 1024, 10);
  const customerPhone = req.body.phone ? phone(req.body.phone) : null;
  const [created] = await pool.execute("INSERT INTO customers (email, password_hash, full_name, phone) VALUES (?, ?, ?, ?)", [address, passwordHash(password), name, customerPhone]);
  if (req.cookies[cookieName]) await pool.execute("DELETE FROM customer_sessions WHERE token_hash = ?", [hashToken(req.cookies[cookieName])]);
  res.status(201).json({ customer: await startSession({ id: created.insertId, email: address, full_name: name, phone: customerPhone }, res) });
  },
);

customerRouter.post(
  "/login",
  rateLimit({ name: "customer-auth-ip", limitEnv: "RATE_LIMIT_CUSTOMER_AUTH_PER_MINUTE", fallbackLimit: 8, key: (req) => [clientAddress(req)], code: "RATE_LIMITED", message: "Too many attempts. Try again shortly." }),
  rateLimit({ name: "customer-auth-account", limitEnv: "RATE_LIMIT_CUSTOMER_AUTH_PER_ACCOUNT_PER_MINUTE", fallbackLimit: 5, key: (req) => [clientAddress(req), identifierHash(req.body?.email)], code: "RATE_LIMITED", message: "Too many attempts. Try again shortly." }),
  async (req, res) => {
  object(req.body, ["email", "password"]);
  const address = email(req.body.email);
  const password = string(req.body.password, "Password", 1024);
  const [rows] = await pool.execute("SELECT id, email, full_name, phone, password_hash FROM customers WHERE email = ?", [address]);
  if (!passwordMatches(password, rows[0]?.password_hash || dummyPasswordHash) || !rows.length) throw new HttpError(401, "INVALID_CREDENTIALS", "Email or password is incorrect");
  if (req.cookies[cookieName]) await pool.execute("DELETE FROM customer_sessions WHERE token_hash = ?", [hashToken(req.cookies[cookieName])]);
  res.json({ customer: await startSession(rows[0], res) });
  },
);

customerRouter.get("/session", async (req, res) => {
  const customer = await getCustomer(req);
  res.set("Cache-Control", "no-store");
  res.json({ customer: customer ? { id: customer.id, email: customer.email, name: customer.name, phone: customer.phone } : null, csrfToken: customer ? csrf(req.cookies[cookieName]) : null });
});

customerRouter.post("/logout", requireCustomer, requireCustomerCsrf, async (req, res) => {
  await pool.execute("DELETE FROM customer_sessions WHERE token_hash = ?", [hashToken(req.customerToken)]);
  res.clearCookie(cookieName, cookieOptions);
  res.status(204).end();
});

customerRouter.put("/profile", requireCustomer, requireCustomerCsrf, async (req, res) => {
  object(req.body, ["name", "phone"]);
  const name = string(req.body.name, "Name");
  const customerPhone = req.body.phone ? phone(req.body.phone) : null;
  await pool.execute("UPDATE customers SET full_name = ?, phone = ? WHERE id = ?", [name, customerPhone, req.customer.id]);
  res.json({ customer: { id: req.customer.id, email: req.customer.email, name, phone: customerPhone } });
});

customerRouter.get("/addresses", requireCustomer, async (req, res) => {
  const [addresses] = await pool.execute("SELECT id, label, recipient_name AS name, phone, address FROM customer_addresses WHERE customer_id = ? ORDER BY id DESC", [req.customer.id]);
  res.json({ addresses });
});

customerRouter.post("/addresses", requireCustomer, requireCustomerCsrf, async (req, res) => {
  object(req.body, ["label", "name", "phone", "address"]);
  const label = string(req.body.label || "Home", "Label", 60);
  const name = string(req.body.name, "Name");
  const customerPhone = phone(req.body.phone);
  const address = string(req.body.address, "Address", 500, 10);
  const [created] = await pool.execute("INSERT INTO customer_addresses (customer_id, label, recipient_name, phone, address) VALUES (?, ?, ?, ?, ?)", [req.customer.id, label, name, customerPhone, address]);
  res.status(201).json({ id: created.insertId });
});

customerRouter.put("/addresses/:id", requireCustomer, requireCustomerCsrf, async (req, res) => {
  object(req.body, ["label", "name", "phone", "address"]);
  const [result] = await pool.execute("UPDATE customer_addresses SET label = ?, recipient_name = ?, phone = ?, address = ? WHERE id = ? AND customer_id = ?", [string(req.body.label, "Label", 60), string(req.body.name, "Name"), phone(req.body.phone), string(req.body.address, "Address", 500, 10), id(req.params.id), req.customer.id]);
  if (!result.affectedRows) throw new HttpError(404, "NOT_FOUND", "Address not found");
  res.json({ message: "Address updated" });
});

customerRouter.delete("/addresses/:id", requireCustomer, requireCustomerCsrf, async (req, res) => {
  const [result] = await pool.execute("DELETE FROM customer_addresses WHERE id = ? AND customer_id = ?", [id(req.params.id), req.customer.id]);
  if (!result.affectedRows) throw new HttpError(404, "NOT_FOUND", "Address not found");
  res.status(204).end();
});
