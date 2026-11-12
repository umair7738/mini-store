import { Router } from "express";
import { pool } from "./db.js";
import { HttpError, id, imageUrl, integer, object, richText, slug, string } from "./validation.js";
import { pagination } from "./pagination.js";

export const publicProducts = Router();
export const adminProducts = Router();

function productInput(body, creating = false) {
  object(body, ["slug", "name", "description", "imageUrl", "images", "sku", "priceFils", "stock", "isActive"]);
  const priceFils = integer(body.priceFils, "Price", 1);
  const sku = string(body.sku, "SKU", 64);
  if (!/^[A-Z0-9-]+$/.test(sku)) throw new HttpError(400, "INVALID_INPUT", "SKU must use uppercase letters, numbers, and hyphens");
  const images = body.images === undefined
    ? body.imageUrl ? [imageUrl(body.imageUrl)] : []
    : Array.isArray(body.images) && body.images.length <= 8
      ? body.images.map(imageUrl)
      : (() => { throw new HttpError(400, "INVALID_INPUT", "Upload up to 8 product images"); })();
  return {
    slug: creating ? slug(body.slug) : undefined,
    name: string(body.name, "Product name"),
    description: richText(body.description),
    images: body.images !== undefined || creating || body.imageUrl !== undefined ? images : undefined,
    imageUrl: body.images !== undefined || creating || body.imageUrl !== undefined ? images[0] || null : undefined,
    sku,
    priceFils,
    stock: integer(body.stock, "Stock"),
    isActive: creating ? body.isActive !== false : body.isActive === undefined ? undefined : body.isActive === true,
  };
}

function mapProduct(row) {
  const images = typeof row.images === "string" ? JSON.parse(row.images) : row.images;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    imageUrl: row.image_url,
    images: images?.length ? images : row.image_url ? [row.image_url] : [],
    sku: row.sku,
    priceFils: row.price_fils,
    stock: row.stock,
    isActive: Boolean(row.is_active),
    ...(row.can_delete !== undefined && { canDelete: Boolean(row.can_delete) }),
  };
}

async function getProducts(includeArchived = false, includeDeleteEligibility = false) {
  const [rows] = await pool.execute(
    `SELECT id, slug, name, description, image_url, images, sku, price_fils, stock, is_active
     ${includeDeleteEligibility ? `,
       NOT EXISTS (SELECT 1 FROM cart_items ci WHERE ci.product_id = products.id)
       AND NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.product_id = products.id) AS can_delete` : ""}
     FROM products ${includeArchived ? "" : "WHERE is_active = 1"} ORDER BY id`,
  );
  return rows.map(mapProduct);
}

publicProducts.get("/", async (req, res) => res.json({ products: await getProducts() }));
publicProducts.get("/:slug", async (req, res) => {
  const product = (await getProducts()).find((item) => item.slug === req.params.slug);
  if (!product) throw new HttpError(404, "NOT_FOUND", "Product not found");
  res.json({ product });
});
adminProducts.get("/", async (req, res) => {
  if (req.query.page === undefined) return res.json({ products: await getProducts(true, true) });
  const { page, search, size } = pagination(req.query);
  const [counts] = await pool.execute("SELECT COUNT(*) AS total FROM products WHERE LOCATE(?, name) > 0 OR LOCATE(?, sku) > 0", [search, search]);
  const total = counts[0].total;
  const currentPage = Math.min(page, Math.max(1, Math.ceil(total / size)));
  const [rows] = await pool.execute(
    `SELECT id, slug, name, description, image_url, images, sku, price_fils, stock, is_active,
       NOT EXISTS (SELECT 1 FROM cart_items ci WHERE ci.product_id = products.id)
       AND NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.product_id = products.id) AS can_delete
     FROM products WHERE LOCATE(?, name) > 0 OR LOCATE(?, sku) > 0 ORDER BY id DESC LIMIT ? OFFSET ?`,
    [search, search, size, (currentPage - 1) * size],
  );
  res.json({ products: rows.map(mapProduct), total, page: currentPage, pageSize: size });
});

adminProducts.post("/", async (req, res) => {
  const product = productInput(req.body, true);
  const [created] = await pool.execute(
    `INSERT INTO products (slug, name, description, image_url, images, sku, price_fils, stock, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [product.slug, product.name, product.description, product.imageUrl, JSON.stringify(product.images), product.sku, product.priceFils, product.stock, product.isActive],
  );
  res.status(201).json({ id: created.insertId });
});

adminProducts.put("/:id", async (req, res) => {
  const product = productInput(req.body);
  const fields = ["name = ?", "description = ?", "sku = ?", "price_fils = ?", "stock = ?"];
  const values = [product.name, product.description, product.sku, product.priceFils, product.stock];
  if (product.images !== undefined) { fields.push("image_url = ?", "images = ?"); values.push(product.imageUrl, JSON.stringify(product.images)); }
  if (product.isActive !== undefined) { fields.push("is_active = ?"); values.push(product.isActive); }
  values.push(id(req.params.id));
  const [result] = await pool.execute(`UPDATE products SET ${fields.join(", ")} WHERE id = ?`, values);
  if (!result.affectedRows) throw new HttpError(404, "NOT_FOUND", "Product not found");
  res.json({ message: "Product updated" });
});

adminProducts.patch("/:id/visibility", async (req, res) => {
  object(req.body, ["isActive"]);
  if (typeof req.body.isActive !== "boolean") throw new HttpError(400, "INVALID_INPUT", "isActive must be a boolean");
  const [result] = await pool.execute("UPDATE products SET is_active = ? WHERE id = ?", [req.body.isActive, id(req.params.id)]);
  if (!result.affectedRows) throw new HttpError(404, "NOT_FOUND", "Product not found");
  res.status(204).end();
});

adminProducts.delete("/:id/permanent", async (req, res) => {
  const productId = id(req.params.id);
  try {
    const [result] = await pool.execute(
      `DELETE FROM products
       WHERE id = ?
         AND NOT EXISTS (SELECT 1 FROM cart_items WHERE product_id = ?)
         AND NOT EXISTS (SELECT 1 FROM order_items WHERE product_id = ?)`,
      [productId, productId, productId],
    );
    if (!result.affectedRows) {
      const [products] = await pool.execute("SELECT id FROM products WHERE id = ?", [productId]);
      if (!products.length) throw new HttpError(404, "NOT_FOUND", "Product not found");
      throw new HttpError(409, "PRODUCT_IN_USE", "Product is used in a cart or order");
    }
  } catch (error) {
    if (error.code === "ER_ROW_IS_REFERENCED_2") throw new HttpError(409, "PRODUCT_IN_USE", "Product is used in a cart or order");
    throw error;
  }
  res.status(204).end();
});

adminProducts.delete("/:id", async (req, res) => {
  const [result] = await pool.execute("UPDATE products SET is_active = 0 WHERE id = ? AND is_active = 1", [id(req.params.id)]);
  if (!result.affectedRows) throw new HttpError(404, "NOT_FOUND", "Product not found");
  res.status(204).end();
});
