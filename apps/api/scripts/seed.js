import { pool } from "../src/db.js";

const products = [
  ["milano-wall-hung-toilet", "Milano Wall-Hung Toilet", "<p>A compact rimless ceramic toilet for contemporary bathrooms.</p>", "/images/products/wall-hung-toilet.png", "DM-WHT-001", 89900, 12],
  ["milano-countertop-basin", "Milano Countertop Basin", "<p>A durable ceramic basin with a clean, rounded profile.</p>", "/images/products/countertop-basin.png", "DM-BSN-001", 59900, 15],
  ["milano-shower-mixer", "Milano Shower Mixer", "<p>A reliable wall-mounted mixer with a smooth single lever.</p>", "/images/products/shower-mixer.png", "DM-MXR-001", 45900, 20],
];

try {
  for (const [slug, name, description, imageUrl, sku, priceFils, stock] of products) {
    await pool.execute(
      `INSERT INTO products (slug, name, description, image_url, images, sku, price_fils, stock)
       VALUES (?, ?, ?, ?, JSON_ARRAY(?), ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         images = IF(COALESCE(JSON_LENGTH(images), 0) = 0, VALUES(images), IF(JSON_UNQUOTE(JSON_EXTRACT(images, '$[0]')) NOT LIKE '/%', JSON_REPLACE(images, '$[0]', VALUES(image_url)), images)),
         image_url = IF(image_url IS NULL OR image_url NOT LIKE '/%', VALUES(image_url), image_url),
         sku = IF(price_fils = 0 AND sku REGEXP '^DM-[0-9]+$', VALUES(sku), sku),
         stock = IF(price_fils = 0, VALUES(stock), stock),
         price_fils = IF(price_fils = 0, VALUES(price_fils), price_fils)`,
      [slug, name, description, imageUrl, imageUrl, sku, priceFils, stock],
    );
    console.log(`Seeded ${name}`);
  }
} finally {
  await pool.end();
}
