import {
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { Router } from "express";
import { pool } from "./db.js";
import { HttpError, email, object, string } from "./validation.js";
import { clientAddress, identifierHash, rateLimit } from "./rateLimit.js";

export const authRouter = Router();
authRouter.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
const cookieName = "mini_admin";
const cookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/api/admin",
};

export const hashToken = (token) => createHash("sha256").update(token).digest();
const csrfToken = (token) =>
  createHmac("sha256", process.env.CSRF_SECRET).update(token).digest("hex");

function passwordMatches(password, saved) {
  const [salt, hex] = saved.split(":");
  const expected = Buffer.from(hex || "", "hex");
  const actual = scryptSync(password, salt, expected.length);
  return expected.length > 0 && timingSafeEqual(actual, expected);
}

authRouter.post(
  "/login",
  rateLimit({ name: "admin-login-ip", limitEnv: "RATE_LIMIT_ADMIN_LOGIN_PER_MINUTE", fallbackLimit: 5, key: (req) => [clientAddress(req)], code: "LOGIN_RATE_LIMITED", message: "Too many login attempts" }),
  rateLimit({ name: "admin-login-account", limitEnv: "RATE_LIMIT_ADMIN_LOGIN_PER_ACCOUNT_PER_MINUTE", fallbackLimit: 5, key: (req) => [clientAddress(req), identifierHash(req.body?.email)], code: "LOGIN_RATE_LIMITED", message: "Too many login attempts" }),
  async (req, res) => {
  object(req.body, ["email", "password"]);
  const address = email(req.body.email);
  const password = string(req.body.password, "Password", 1024);
  const [users] = await pool.execute(
    "SELECT id, password_hash FROM admin_users WHERE email = ?",
    [address],
  );
  if (!users.length || !passwordMatches(password, users[0].password_hash)) {
    throw new HttpError(
      401,
      "INVALID_CREDENTIALS",
      "Invalid email or password",
    );
  }

  const token = randomBytes(32).toString("base64url");
  if (req.cookies[cookieName]) await pool.execute("DELETE FROM admin_sessions WHERE token_hash = ?", [hashToken(req.cookies[cookieName])]);
  await pool.execute(
    "INSERT INTO admin_sessions (token_hash, admin_user_id, expires_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 12 HOUR))",
    [hashToken(token), users[0].id],
  );
  res.cookie(cookieName, token, {
    ...cookieOptions,
    maxAge: 12 * 60 * 60 * 1000,
  });
  res.json({ email: address, csrfToken: csrfToken(token) });
  },
);

export async function requireAdmin(req, res, next) {
  try {
    const token = req.cookies[cookieName];
    if (!token)
      throw new HttpError(401, "UNAUTHORIZED", "Admin login required");
    const [sessions] = await pool.execute(
      `SELECT u.id, u.email FROM admin_sessions s JOIN admin_users u ON u.id = s.admin_user_id
       WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP(6)`,
      [hashToken(token)],
    );
    if (!sessions.length)
      throw new HttpError(401, "UNAUTHORIZED", "Admin session expired");
    req.admin = sessions[0];
    req.adminToken = token;
    next();
  } catch (error) {
    next(error);
  }
}

export function requireCsrf(req, res, next) {
  const provided = req.get("X-CSRF-Token") || "";
  const expected = csrfToken(req.adminToken);
  const actual = Buffer.from(provided);
  if (
    actual.length !== expected.length ||
    !timingSafeEqual(actual, Buffer.from(expected))
  ) {
    return next(new HttpError(403, "CSRF_REJECTED", "Invalid CSRF token"));
  }
  next();
}

authRouter.get("/session", requireAdmin, (req, res) => {
  res.json({ email: req.admin.email, csrfToken: csrfToken(req.adminToken) });
});

authRouter.post("/logout", requireAdmin, requireCsrf, async (req, res) => {
  await pool.execute("DELETE FROM admin_sessions WHERE token_hash = ?", [
    hashToken(req.adminToken),
  ]);
  res.clearCookie(cookieName, cookieOptions);
  res.status(204).end();
});
