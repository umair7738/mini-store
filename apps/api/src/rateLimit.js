import { createHash } from "node:crypto";
import { HttpError } from "./validation.js";

const buckets = new Map();
const defaultWindowMs = 60_000;

function integerSetting(name, fallback, min, max) {
  const value = process.env[name];
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return parsed;
}

function cleanup(now, maxKeys) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function clientAddress(req) {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

export function identifierHash(value) {
  return createHash("sha256").update(String(value || "").trim().toLowerCase()).digest("hex").slice(0, 32);
}

export function cookieKey(req, name) {
  return req.cookies?.[name] ? identifierHash(req.cookies[name]) : "missing";
}

export function rateLimit({ name, limitEnv, fallbackLimit, windowMs = defaultWindowMs, windowEnv, key, code = "RATE_LIMITED", message = "Too many requests" }) {
  const limit = integerSetting(limitEnv, fallbackLimit, 1, 1_000_000);
  const configuredWindow = windowEnv
    ? integerSetting(windowEnv, Math.ceil(windowMs / 1000), 1, 86_400)
    : Math.ceil(windowMs / 1000);
  const duration = configuredWindow * 1000;
  const maxKeys = integerSetting("RATE_LIMIT_MAX_KEYS", 10_000, 100, 1_000_000);

  return (req, res, next) => {
    const now = Date.now();
    cleanup(now, maxKeys);
    const parts = [...new Set((key(req) || []).map((part) => `${name}:${String(part)}`))];
    if (buckets.size + parts.filter((part) => !buckets.has(part)).length > maxKeys) {
      res.set("Retry-After", "60");
      return next(new HttpError(429, code, message));
    }
    let retryAfter = 0;
    for (const part of parts) {
      const bucket = buckets.get(part);
      if (bucket && bucket.resetAt > now && bucket.count >= limit) {
        retryAfter = Math.max(retryAfter, bucket.resetAt - now);
      }
    }
    if (retryAfter) {
      res.set("Retry-After", String(Math.max(1, Math.ceil(retryAfter / 1000))));
      return next(new HttpError(429, code, message));
    }
    for (const part of parts) {
      const bucket = buckets.get(part);
      if (!bucket || bucket.resetAt <= now) buckets.set(part, { count: 1, resetAt: now + duration });
      else bucket.count += 1;
    }
    next();
  };
}
