import { Router } from "express";
import { pool } from "./db.js";
import {
  HttpError,
  attributes,
  id,
  integer,
  object,
  slug,
  string,
} from "./validation.js";

export const publicProducts = Router();
export const adminProducts = Router();

function variantInput(body) {
  object(body);
  const sku = string(body.sku, "SKU", 64);
  const variantKey = string(body.variantKey, "Variant key", 80);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(variantKey)) {
    throw new HttpError(
      400,
      "INVALID_INPUT",
      "Variant key must use lowercase letters, numbers, and hyphens",
    );
  }
  if (!/^[A-Z0-9-]+$/.test(sku))
    throw new HttpError(
      400,
      "INVALID_INPUT",
      "SKU must use uppercase letters, numbers, and hyphens",
    );
  return {
    variantKey,
    label: string(body.label, "Variant label", 100),
    attributes: attributes(body.attributes),
    sku,
    priceFils: integer(body.priceFils, "Price", 1),
    stock: integer(body.stock, "Stock"),
  };
}

function productInput(body, creating = false) {
  object(body);
  return {
    slug: creating ? slug(body.slug) : undefined,
    name: string(body.name, "Product name"),
    description: string(body.description, "Description", 5000),
  };
}

function mapVariant(row) {
  return {
    id: row.id,
    variantKey: row.variant_key,
    label: row.label,
    attributes: row.attributes,
    sku: row.sku,
    priceFils: row.price_fils,
    stock: row.stock,
    isActive: Boolean(row.is_active),
  };
}

async function getProducts(includeArchived = false) {
  const [products] = await pool.execute(
    `SELECT id, slug, name, description, is_active FROM products ${includeArchived ? "" : "WHERE is_active = 1"} ORDER BY id`,
  );
  if (!products.length) return [];
  const [variants] = await pool.query(
    `SELECT id, product_id, variant_key, label, attributes, sku, price_fils, stock, is_active
     FROM product_variants WHERE product_id IN (${products.map(() => "?").join(",")})
     ${includeArchived ? "" : "AND is_active = 1"} ORDER BY id`,
    products.map((product) => product.id),
  );
  return products
    .map((product) => ({
      id: product.id,
      slug: product.slug,
      name: product.name,
      description: product.description,
      isActive: Boolean(product.is_active),
      variants: variants
        .filter((variant) => variant.product_id === product.id)
        .map(mapVariant),
    }))
    .filter((product) => includeArchived || product.variants.length > 0);
}

publicProducts.get("/", async (req, res) =>
  res.json({ products: await getProducts() }),
);
publicProducts.get("/:slug", async (req, res) => {
  const products = await getProducts();
  const product = products.find((item) => item.slug === req.params.slug);
  if (!product) throw new HttpError(404, "NOT_FOUND", "Product not found");
  res.json({ product });
});

adminProducts.get("/", async (req, res) =>
  res.json({ products: await getProducts(true) }),
);

adminProducts.post("/", async (req, res) => {
  const product = productInput(req.body, true);
  if (
    !Array.isArray(req.body.variants) ||
    !req.body.variants.length ||
    req.body.variants.length > 20
  ) {
    throw new HttpError(400, "INVALID_INPUT", "Provide 1–20 variants");
  }
  const variants = req.body.variants.map(variantInput);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [created] = await connection.execute(
      "INSERT INTO products (slug, name, description) VALUES (?, ?, ?)",
      [product.slug, product.name, product.description],
    );
    for (const variant of variants) {
      await connection.execute(
        "INSERT INTO product_variants (product_id, variant_key, label, attributes, sku, price_fils, stock) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          created.insertId,
          variant.variantKey,
          variant.label,
          variant.attributes,
          variant.sku,
          variant.priceFils,
          variant.stock,
        ],
      );
    }
    await connection.commit();
    res.status(201).json({ id: created.insertId });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
});

adminProducts.put("/:id", async (req, res) => {
  const product = productInput(req.body);
  const [result] = await pool.execute(
    "UPDATE products SET name = ?, description = ? WHERE id = ? AND is_active = 1",
    [product.name, product.description, id(req.params.id)],
  );
  if (!result.affectedRows)
    throw new HttpError(404, "NOT_FOUND", "Product not found");
  res.json({ message: "Product updated" });
});

adminProducts.delete("/:id", async (req, res) => {
  const [result] = await pool.execute(
    "UPDATE products SET is_active = 0 WHERE id = ? AND is_active = 1",
    [id(req.params.id)],
  );
  if (!result.affectedRows)
    throw new HttpError(404, "NOT_FOUND", "Product not found");
  res.status(204).end();
});

adminProducts.post("/:id/variants", async (req, res) => {
  const variant = variantInput(req.body);
  const [result] = await pool.execute(
    `INSERT INTO product_variants (product_id, variant_key, label, attributes, sku, price_fils, stock)
     SELECT id, ?, ?, ?, ?, ?, ? FROM products WHERE id = ? AND is_active = 1`,
    [
      variant.variantKey,
      variant.label,
      variant.attributes,
      variant.sku,
      variant.priceFils,
      variant.stock,
      id(req.params.id),
    ],
  );
  if (!result.affectedRows)
    throw new HttpError(404, "NOT_FOUND", "Product not found");
  res.status(201).json({ id: result.insertId });
});

adminProducts.put("/variants/:id", async (req, res) => {
  const variant = variantInput(req.body);
  const [result] = await pool.execute(
    `UPDATE product_variants v JOIN products p ON p.id = v.product_id
     SET v.variant_key = ?, v.label = ?, v.attributes = ?, v.sku = ?, v.price_fils = ?, v.stock = ?
     WHERE v.id = ? AND v.is_active = 1 AND p.is_active = 1`,
    [
      variant.variantKey,
      variant.label,
      variant.attributes,
      variant.sku,
      variant.priceFils,
      variant.stock,
      id(req.params.id),
    ],
  );
  if (!result.affectedRows)
    throw new HttpError(404, "NOT_FOUND", "Variant not found");
  res.json({ message: "Variant updated" });
});

adminProducts.delete("/variants/:id", async (req, res) => {
  const [result] = await pool.execute(
    "UPDATE product_variants SET is_active = 0 WHERE id = ? AND is_active = 1",
    [id(req.params.id)],
  );
  if (!result.affectedRows)
    throw new HttpError(404, "NOT_FOUND", "Variant not found");
  res.status(204).end();
});
