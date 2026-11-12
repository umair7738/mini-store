ALTER TABLE products
  ADD COLUMN image_url VARCHAR(500) NULL AFTER description;

ALTER TABLE cart_items
  ADD CONSTRAINT chk_cart_quantity_phase2 CHECK (quantity BETWEEN 1 AND 20);
