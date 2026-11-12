import cookieParser from "cookie-parser";
import express from "express";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";
import { authRouter, requireAdmin, requireCsrf } from "./auth.js";
import { publicProducts, adminProducts } from "./products.js";
import { cartRouter } from "./cart.js";
import { checkoutRouter } from "./checkout.js";
import { ordersRouter, adminOrders } from "./orders.js";
import { uploadDir, uploadsRouter } from "./uploads.js";
import { customerRouter } from "./customerAuth.js";
import { HttpError } from "./validation.js";
import { clientAddress, cookieKey, rateLimit } from "./rateLimit.js";

if (!process.env.CSRF_SECRET || process.env.CSRF_SECRET.length < 32) {
  throw new Error("CSRF_SECRET must be set to at least 32 characters");
}

export const app = express();
app.disable("x-powered-by");
if (process.env.TRUST_PROXY_HOPS) {
  const hops = Number(process.env.TRUST_PROXY_HOPS);
  if (!Number.isInteger(hops) || hops < 1 || hops > 10) throw new Error("TRUST_PROXY_HOPS must be an integer from 1 to 10");
  app.set("trust proxy", hops);
}
app.use((req, res, next) => {
  req.requestId = randomUUID();
  res.set("X-Request-ID", req.requestId);
  const started = Date.now();
  res.on("finish", () => console.info(JSON.stringify({ requestId: req.requestId, method: req.method, route: req.baseUrl || "/", status: res.statusCode, durationMs: Date.now() - started })));
  next();
});
app.use(express.json({ limit: "32kb" }));
app.use(cookieParser());
app.use((req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  });
  if (process.env.NODE_ENV === "production") res.set("Strict-Transport-Security", "max-age=31536000");
  next();
});

app.use((req, res, next) => {
  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    req.get("Origin") !== process.env.WEB_ORIGIN
  ) {
    return next(
      new HttpError(403, "ORIGIN_REJECTED", "Request origin is not allowed"),
    );
  }
  next();
});

app.get("/api/health", async (req, res) => {
  await pool.query("SELECT 1");
  res.json({ status: "ok" });
});
app.use("/api/uploads/products", express.static(uploadDir));
app.use("/api/products", rateLimit({ name: "products", limitEnv: "RATE_LIMIT_PUBLIC_PER_MINUTE", fallbackLimit: 120, key: (req) => [clientAddress(req)] }), publicProducts);
app.use("/api/cart", rateLimit({ name: "cart", limitEnv: "RATE_LIMIT_CART_PER_MINUTE", fallbackLimit: 60, key: (req) => [clientAddress(req), cookieKey(req, "mini_cart")] }), cartRouter);
app.use("/api/checkout",
  rateLimit({ name: "checkout-ip", limitEnv: "RATE_LIMIT_CHECKOUT_PER_MINUTE", fallbackLimit: 10, key: (req) => [clientAddress(req)] }),
  rateLimit({ name: "checkout-session", limitEnv: "RATE_LIMIT_CHECKOUT_SESSION_PER_MINUTE", fallbackLimit: 5, key: (req) => [clientAddress(req), cookieKey(req, "mini_cart")] }),
  checkoutRouter,
);
app.use("/api/orders", ordersRouter);
app.use("/api/customer", customerRouter);
app.use("/api/admin", authRouter);
app.use(
  "/api/admin/uploads",
  requireAdmin,
  rateLimit({ name: "admin-upload", limitEnv: "RATE_LIMIT_UPLOADS_PER_MINUTE", fallbackLimit: 10, key: (req) => [cookieKey(req, "mini_admin")] }),
  (req, res, next) => req.method === "GET" ? next() : requireCsrf(req, res, next),
  uploadsRouter,
);
app.use(
  "/api/admin/products",
  requireAdmin,
  rateLimit({ name: "admin-products", limitEnv: "RATE_LIMIT_ADMIN_MUTATIONS_PER_MINUTE", fallbackLimit: 60, key: (req) => [cookieKey(req, "mini_admin")] }),
  (req, res, next) => {
    if (["GET", "HEAD"].includes(req.method)) return next();
    requireCsrf(req, res, next);
  },
  adminProducts,
);
app.use(
  "/api/admin/orders",
  requireAdmin,
  rateLimit({ name: "admin-orders", limitEnv: "RATE_LIMIT_ADMIN_MUTATIONS_PER_MINUTE", fallbackLimit: 60, key: (req) => [cookieKey(req, "mini_admin")] }),
  (req, res, next) => {
    if (["GET", "HEAD"].includes(req.method)) return next();
    requireCsrf(req, res, next);
  },
  adminOrders,
);
app.use((req, res, next) =>
  next(new HttpError(404, "NOT_FOUND", "Route not found")),
);
app.use((error, req, res, next) => {
  if (error.code === "ER_DUP_ENTRY") {
    const key = error.sqlMessage?.match(/for key '([^']+)'/)?.[1] || "";
    if (key.includes("email") && error.sqlMessage?.includes("customers")) return res.status(409).json({ code: "EMAIL_REGISTERED", message: "An account already exists for this email", requestId: req.requestId });
    const field = key.includes("slug") ? "slug" : key.includes("sku") ? "sku" : undefined;
    return res.status(409).json({
      code: "DUPLICATE_VALUE",
      message: "A product with this slug or SKU already exists",
      ...(field && { field }),
      requestId: req.requestId,
    });
  }
  if (error instanceof SyntaxError && error.status === 400) {
    return res
      .status(400)
      .json({ code: "INVALID_JSON", message: "Malformed JSON body", requestId: req.requestId });
  }
  if (error instanceof HttpError) {
    return res
      .status(error.status)
      .json({ code: error.code, message: error.message, requestId: req.requestId });
  }
  if (req.path === "/api/health") {
    console.error(JSON.stringify({ requestId: req.requestId, error: error.name, code: "HEALTH_DEPENDENCY_UNAVAILABLE" }));
    return res.status(503).json({ code: "SERVICE_UNAVAILABLE", message: "Service dependency unavailable", requestId: req.requestId });
  }
  console.error(JSON.stringify({ requestId: req.requestId, error: error.name, code: error.code || "UNEXPECTED_ERROR" }));
  res
    .status(500)
    .json({ code: "SERVER_ERROR", message: "Unexpected server error", requestId: req.requestId });
});

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  app.listen(Number(process.env.PORT || 4000), () =>
    console.log(`API ready on port ${process.env.PORT || 4000}`),
  );
}
