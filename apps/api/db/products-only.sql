ALTER TABLE products
  ADD COLUMN sku VARCHAR(64) NULL UNIQUE,
  ADD COLUMN price_fils INT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN stock INT UNSIGNED NOT NULL DEFAULT 0;

UPDATE products SET sku = CONCAT('DM-', id) WHERE sku IS NULL;

DELETE FROM cart_items;
ALTER TABLE cart_items ADD INDEX idx_cart_items_cart (cart_id);
ALTER TABLE cart_items DROP FOREIGN KEY fk_cart_items_variant;
ALTER TABLE cart_items DROP PRIMARY KEY, DROP COLUMN variant_id;
ALTER TABLE cart_items ADD COLUMN product_id INT UNSIGNED NOT NULL AFTER cart_id;
ALTER TABLE cart_items ADD PRIMARY KEY (cart_id, product_id);
ALTER TABLE cart_items DROP INDEX idx_cart_items_cart;
ALTER TABLE cart_items ADD CONSTRAINT fk_cart_items_product FOREIGN KEY (product_id) REFERENCES products(id);

ALTER TABLE order_items ADD COLUMN product_id INT UNSIGNED NULL AFTER order_id;
UPDATE order_items oi JOIN product_variants v ON v.id = oi.variant_id
SET oi.product_id = v.product_id;
ALTER TABLE order_items DROP FOREIGN KEY fk_order_items_variant;
ALTER TABLE order_items DROP COLUMN variant_id;
ALTER TABLE order_items MODIFY variant_key VARCHAR(80) NULL,
  MODIFY variant_label VARCHAR(100) NULL,
  MODIFY variant_attributes JSON NULL;
ALTER TABLE order_items ADD CONSTRAINT fk_order_items_product FOREIGN KEY (product_id) REFERENCES products(id);

DROP TABLE product_variants;
ALTER TABLE products MODIFY sku VARCHAR(64) NOT NULL;
