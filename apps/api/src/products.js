import { Router } from "express";
import { pool } from "./db.js";
import { HttpError, id, imageUrl, integer, object, richText, slug, string } from "./validation.js";

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
  };
}

async function getProducts(includeArchived = false) {
  const [rows] = await pool.execute(
    `SELECT id, slug, name, description, image_url, images, sku, price_fils, stock, is_active
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
adminProducts.get("/", async (req, res) => res.json({ products: await getProducts(true) }));

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

adminProducts.delete("/:id", async (req, res) => {
  const [result] = await pool.execute("UPDATE products SET is_active = 0 WHERE id = ? AND is_active = 1", [id(req.params.id)]);
  if (!result.affectedRows) throw new HttpError(404, "NOT_FOUND", "Product not found");
  res.status(204).end();
});
