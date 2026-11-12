import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { pool } from "./db.js";
import { hashToken } from "./auth.js";
import { HttpError, email, object, phone, string, id } from "./validation.js";
import { clientAddress, identifierHash, rateLimit } from "./rateLimit.js";
import { isEmailConfigured, sendVerificationEmail } from "./mail.js";

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
export function setSession(res, token) { res.cookie(cookieName, token, cookieOptions); }

export async function getCustomer(req, db = pool) {
  const token = req.cookies?.[cookieName];
  if (!token) return null;
  const [rows] = await db.execute(
    `SELECT c.id, COALESCE(c.email, c.pending_email) AS email, c.email IS NOT NULL AS verified, c.full_name AS name, c.phone, s.token_hash
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

function requireVerifiedCustomer(req, res, next) {
  if (!req.customer.verified) return next(new HttpError(403, "EMAIL_VERIFICATION_REQUIRED", "Verify your email to access account features"));
  next();
}

export function requireCustomerCsrf(req, res, next) {
  const expected = csrf(req.customerToken);
  const actual = Buffer.from(req.get("X-CSRF-Token") || "");
  if (actual.length !== expected.length || !timingSafeEqual(actual, Buffer.from(expected))) return next(new HttpError(403, "CSRF_REJECTED", "Invalid CSRF token"));
  next();
}

export async function startSession(customer, res, db = pool) {
  const token = randomBytes(32).toString("base64url");
  await db.execute("INSERT INTO customer_sessions (token_hash, customer_id, expires_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 30 DAY))", [hashToken(token), customer.id]);
  if (res) setSession(res, token);
  else return token;
  return { id: customer.id, email: customer.email, name: customer.full_name, phone: customer.phone, csrfToken: csrf(token) };
}

async function createVerificationToken(db, customerId) {
  const token = randomBytes(32).toString("base64url");
  await db.execute("DELETE FROM customer_verification_tokens WHERE customer_id = ? OR expires_at <= UTC_TIMESTAMP(6)", [customerId]);
  await db.execute("INSERT INTO customer_verification_tokens (token_hash, customer_id, expires_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 1 HOUR))", [hashToken(token), customerId]);
  return token;
}



customerRouter.post(
  "/register",
  rateLimit({ name: "customer-auth-ip", limitEnv: "RATE_LIMIT_CUSTOMER_AUTH_PER_MINUTE", fallbackLimit: 8, key: (req) => [clientAddress(req)], code: "RATE_LIMITED", message: "Too many attempts. Try again shortly." }),
  rateLimit({ name: "customer-auth-account", limitEnv: "RATE_LIMIT_CUSTOMER_AUTH_PER_ACCOUNT_PER_MINUTE", fallbackLimit: 5, key: (req) => [clientAddress(req), identifierHash(req.body?.email)], code: "RATE_LIMITED", message: "Too many attempts. Try again shortly." }),
  async (req, res) => {
  object(req.body, ["name", "email", "phone", "password"]);
  const address = email(req.body.email);
  const name = string(req.body.name, "Name");
  const customerPhone = req.body.phone ? phone(req.body.phone) : null;
  const pendingPassword = req.body.password === undefined ? randomBytes(32).toString("base64url") : string(req.body.password, "Password", 1024, 10);
  if (!isEmailConfigured()) throw new HttpError(503, "EMAIL_NOT_CONFIGURED", "Email verification is not configured");
  const connection = await pool.getConnection();
  let customerToken;
  let verificationToken;
  try {
    await connection.beginTransaction();
    const current = await getCustomer(req, connection);
    const [existing] = await connection.execute("SELECT id FROM customers WHERE email = ? FOR UPDATE", [address]);
    if (!current?.verified && !existing.length) {
      let customerId;
      if (current?.email === address) {
        const [updated] = await connection.execute("UPDATE customers SET password_hash = ?, full_name = ?, phone = ? WHERE id = ? AND email IS NULL AND pending_email = ?", [passwordHash(pendingPassword), name, customerPhone, current.id, address]);
        if (updated.affectedRows) customerId = current.id;
      } else {
        const [created] = await connection.execute("INSERT INTO customers (email, pending_email, password_hash, full_name, phone) VALUES (NULL, ?, ?, ?, ?)", [address, passwordHash(pendingPassword), name, customerPhone]);
        customerId = created.insertId;
        customerToken = await startSession({ id: customerId }, null, connection);
      }
      if (customerId) verificationToken = await createVerificationToken(connection, customerId);
    }
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
  if (customerToken) setSession(res, customerToken);
  if (verificationToken) {
    try { await sendVerificationEmail(address, verificationToken); }
    catch { console.error("Customer verification email delivery failed"); }
  }
  res.status(202).json({ message: "If this email can be registered, a verification link will be sent." });
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
  const current = await getCustomer(req);
  if (current && !current.verified && current.email === address) {
    await pool.execute("UPDATE orders SET customer_id = ? WHERE customer_id = ?", [rows[0].id, current.id]);
  }
  if (req.cookies[cookieName]) await pool.execute("DELETE FROM customer_sessions WHERE token_hash = ?", [hashToken(req.cookies[cookieName])]);
  res.json({ customer: await startSession(rows[0], res) });
  },
);

customerRouter.get("/session", async (req, res) => {
  const customer = await getCustomer(req);
  res.set("Cache-Control", "no-store");
  res.json({ customer: customer ? { id: customer.id, email: customer.email, name: customer.name, phone: customer.phone, verified: !!customer.verified } : null, csrfToken: customer ? csrf(req.cookies[cookieName]) : null });
});

customerRouter.post("/verification", requireCustomer, requireCustomerCsrf,
  rateLimit({ name: "customer-verification", limitEnv: "RATE_LIMIT_CUSTOMER_AUTH_PER_MINUTE", fallbackLimit: 8, key: (req) => [clientAddress(req)] }),
  async (req, res) => {
    if (req.customer.verified) throw new HttpError(400, "ALREADY_VERIFIED", "Your email is already verified");
  if (!isEmailConfigured()) throw new HttpError(503, "EMAIL_NOT_CONFIGURED", "Email verification is not configured");
    const token = await createVerificationToken(pool, req.customer.id);
    await sendVerificationEmail(req.customer.email, token);
    res.json({ message: "Check your email for a verification link." });
  });

customerRouter.post("/verification/confirm",
  rateLimit({ name: "customer-verification-confirm", limitEnv: "RATE_LIMIT_CUSTOMER_AUTH_PER_MINUTE", fallbackLimit: 8, key: (req) => [clientAddress(req)] }),
  async (req, res) => {
    object(req.body, ["token", "password"]);
    const token = string(req.body.token, "Verification token", 100);
    const password = string(req.body.password, "Password", 1024, 10);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new HttpError(400, "INVALID_TOKEN", "Verification link is invalid or expired");
    const connection = await pool.getConnection();
    let customerToken;
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute("SELECT c.id, c.pending_email FROM customer_verification_tokens t JOIN customers c ON c.id = t.customer_id WHERE t.token_hash = ? AND t.expires_at > UTC_TIMESTAMP(6) AND c.email IS NULL FOR UPDATE", [hashToken(token)]);
      if (!rows.length) throw new HttpError(400, "INVALID_TOKEN", "Verification link is invalid or expired");
      const [existing] = await connection.execute("SELECT id FROM customers WHERE email = ?", [rows[0].pending_email]);
      if (existing.length) throw new HttpError(400, "INVALID_TOKEN", "Verification link is invalid or expired");
      await connection.execute("UPDATE customers SET email = pending_email, pending_email = NULL, password_hash = ? WHERE id = ?", [passwordHash(password), rows[0].id]);
      await connection.execute("DELETE FROM customer_verification_tokens WHERE customer_id = ?", [rows[0].id]);
      await connection.execute("DELETE FROM customer_sessions WHERE customer_id = ?", [rows[0].id]);
      customerToken = await startSession({ id: rows[0].id }, null, connection);
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
    setSession(res, customerToken);
    res.json({ message: "Email verified. You are now signed in." });
  });

customerRouter.post("/logout", requireCustomer, requireCustomerCsrf, async (req, res) => {
  await pool.execute("DELETE FROM customer_sessions WHERE token_hash = ?", [hashToken(req.customerToken)]);
  res.clearCookie(cookieName, cookieOptions);
  res.status(204).end();
});

customerRouter.put("/profile", requireCustomer, requireCustomerCsrf, requireVerifiedCustomer, async (req, res) => {
  object(req.body, ["name", "phone"]);
  const name = string(req.body.name, "Name");
  const customerPhone = req.body.phone ? phone(req.body.phone) : null;
  await pool.execute("UPDATE customers SET full_name = ?, phone = ? WHERE id = ?", [name, customerPhone, req.customer.id]);
  res.json({ customer: { id: req.customer.id, email: req.customer.email, name, phone: customerPhone } });
});

customerRouter.get("/addresses", requireCustomer, requireVerifiedCustomer, async (req, res) => {
  const [addresses] = await pool.execute("SELECT id, label, recipient_name AS name, phone, address FROM customer_addresses WHERE customer_id = ? ORDER BY id DESC", [req.customer.id]);
  res.json({ addresses });
});

customerRouter.post("/addresses", requireCustomer, requireCustomerCsrf, requireVerifiedCustomer, async (req, res) => {
  object(req.body, ["label", "name", "phone", "address"]);
  const label = string(req.body.label || "Home", "Label", 60);
  const name = string(req.body.name, "Name");
  const customerPhone = phone(req.body.phone);
  const address = string(req.body.address, "Address", 500, 10);
  const [created] = await pool.execute("INSERT INTO customer_addresses (customer_id, label, recipient_name, phone, address) VALUES (?, ?, ?, ?, ?)", [req.customer.id, label, name, customerPhone, address]);
  res.status(201).json({ id: created.insertId });
});

customerRouter.put("/addresses/:id", requireCustomer, requireCustomerCsrf, requireVerifiedCustomer, async (req, res) => {
  object(req.body, ["label", "name", "phone", "address"]);
  const [result] = await pool.execute("UPDATE customer_addresses SET label = ?, recipient_name = ?, phone = ?, address = ? WHERE id = ? AND customer_id = ?", [string(req.body.label, "Label", 60), string(req.body.name, "Name"), phone(req.body.phone), string(req.body.address, "Address", 500, 10), id(req.params.id), req.customer.id]);
  if (!result.affectedRows) throw new HttpError(404, "NOT_FOUND", "Address not found");
  res.json({ message: "Address updated" });
});

customerRouter.delete("/addresses/:id", requireCustomer, requireCustomerCsrf, requireVerifiedCustomer, async (req, res) => {
  const [result] = await pool.execute("DELETE FROM customer_addresses WHERE id = ? AND customer_id = ?", [id(req.params.id), req.customer.id]);
  if (!result.affectedRows) throw new HttpError(404, "NOT_FOUND", "Address not found");
  res.status(204).end();
});
