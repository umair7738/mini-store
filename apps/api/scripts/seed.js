import { pool } from "../src/db.js";

const products = [
  {
    slug: "milano-wall-hung-toilet",
    name: "Milano Wall-Hung Toilet",
    description: "A compact rimless ceramic toilet for contemporary bathrooms.",
    variants: [
      [
        "white",
        "Gloss White",
        { color: "Gloss White" },
        "DM-WHT-WHT",
        89900,
        12,
      ],
      [
        "matte-black",
        "Matte Black",
        { color: "Matte Black" },
        "DM-WHT-BLK",
        109900,
        8,
      ],
    ],
  },
  {
    slug: "milano-countertop-basin",
    name: "Milano Countertop Basin",
    description: "A durable ceramic basin with a clean, rounded profile.",
    variants: [
      [
        "white-45cm",
        "White · 45 cm",
        { color: "White", widthCm: 45 },
        "DM-BSN-45W",
        59900,
        15,
      ],
      [
        "white-60cm",
        "White · 60 cm",
        { color: "White", widthCm: 60 },
        "DM-BSN-60W",
        74900,
        10,
      ],
    ],
  },
  {
    slug: "milano-shower-mixer",
    name: "Milano Shower Mixer",
    description: "A reliable wall-mounted mixer with a smooth single lever.",
    variants: [
      [
        "chrome",
        "Polished Chrome",
        { finish: "Polished Chrome" },
        "DM-MXR-CHR",
        45900,
        20,
      ],
      [
        "brushed-gold",
        "Brushed Gold",
        { finish: "Brushed Gold" },
        "DM-MXR-GLD",
        62900,
        7,
      ],
    ],
  },
];

const connection = await pool.getConnection();
try {
  for (const product of products) {
    await connection.beginTransaction();
    try {
      const [existing] = await connection.execute(
        "SELECT id FROM products WHERE slug = ?",
        [product.slug],
      );
      if (!existing.length) {
        const [created] = await connection.execute(
          "INSERT INTO products (slug, name, description) VALUES (?, ?, ?)",
          [product.slug, product.name, product.description],
        );
        for (const [
          key,
          label,
          attributes,
          sku,
          price,
          stock,
        ] of product.variants) {
          await connection.execute(
            "INSERT INTO product_variants (product_id, variant_key, label, attributes, sku, price_fils, stock) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [
              created.insertId,
              key,
              label,
              JSON.stringify(attributes),
              sku,
              price,
              stock,
            ],
          );
        }
        console.log(`Seeded ${product.name}`);
      } else {
        console.log(`Kept existing ${product.name}`);
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  }
} finally {
  connection.release();
  await pool.end();
}
