import cookieParser from "cookie-parser";
import express from "express";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";
import { authRouter, requireAdmin, requireCsrf } from "./auth.js";
import { publicProducts, adminProducts } from "./products.js";
import { cartRouter } from "./cart.js";
import { checkoutRouter } from "./checkout.js";
import { ordersRouter, adminOrders } from "./orders.js";
import { HttpError } from "./validation.js";

if (!process.env.CSRF_SECRET || process.env.CSRF_SECRET.length < 32) {
  throw new Error("CSRF_SECRET must be set to at least 32 characters");
}

export const app = express();
app.disable("x-powered-by");
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
app.use("/api/products", publicProducts);
app.use("/api/cart", cartRouter);
app.use("/api/checkout", checkoutRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/admin", authRouter);
app.use(
  "/api/admin/products",
  requireAdmin,
  (req, res, next) => {
    if (["GET", "HEAD"].includes(req.method)) return next();
    requireCsrf(req, res, next);
  },
  adminProducts,
);
app.use(
  "/api/admin/orders",
  requireAdmin,
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
    const field = key.includes("slug")
      ? "slug"
      : key.includes("sku")
        ? "sku"
        : key.includes("variant_key")
          ? "variantKey"
          : undefined;
    return res.status(409).json({
      code: "DUPLICATE_VALUE",
      message: "Slug, SKU, or variant key already exists",
      ...(field && { field }),
    });
  }
  if (error instanceof SyntaxError && error.status === 400) {
    return res
      .status(400)
      .json({ code: "INVALID_JSON", message: "Malformed JSON body" });
  }
  if (error instanceof HttpError) {
    return res
      .status(error.status)
      .json({ code: error.code, message: error.message });
  }
  console.error(error);
  res
    .status(500)
    .json({ code: "SERVER_ERROR", message: "Unexpected server error" });
});

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  app.listen(Number(process.env.PORT || 4000), () =>
    console.log(`API ready on port ${process.env.PORT || 4000}`),
  );
}
