import { randomBytes } from "node:crypto";
import { pool } from "./db.js";
import { hashToken } from "./auth.js";

const cookieName = "mini_guest";
const cookieOptions = { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/api" };

function sessionDays() {
  const days = Number(process.env.GUEST_SESSION_DAYS || 30);
  return Number.isInteger(days) && days >= 1 && days <= 90 ? days : 30;
}

export async function getGuestSession(req, db = pool, create = false) {
  const token = req.cookies?.[cookieName];
  if (token) {
    const [rows] = await db.execute("SELECT id FROM guest_sessions WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP(6)", [hashToken(token)]);
    if (rows.length) return { id: rows[0].id, token, isNew: false };
  }
  if (!create) return null;
  const newToken = randomBytes(32).toString("base64url");
  const [created] = await db.execute(`INSERT INTO guest_sessions (token_hash, expires_at) VALUES (?, DATE_ADD(UTC_TIMESTAMP(6), INTERVAL ${sessionDays()} DAY))`, [hashToken(newToken)]);
  return { id: created.insertId, token: newToken, isNew: true };
}

export function setGuestCookie(res, token) {
  res.cookie(cookieName, token, { ...cookieOptions, maxAge: sessionDays() * 86400000 });
}

export async function forgetGuestSession(req, res, db = pool) {
  const token = req.cookies?.[cookieName];
  if (token) await db.execute("UPDATE guest_sessions SET revoked_at = UTC_TIMESTAMP(6) WHERE token_hash = ? AND revoked_at IS NULL", [hashToken(token)]);
  res.clearCookie(cookieName, cookieOptions);
}
