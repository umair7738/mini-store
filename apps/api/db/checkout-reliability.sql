ALTER TABLE orders
  ADD COLUMN customer_phone VARCHAR(30) NULL AFTER customer_email;

ALTER TABLE orders
  ADD COLUMN idempotency_key VARCHAR(128) NULL AFTER total_fils;

ALTER TABLE orders
  ADD UNIQUE INDEX uq_orders_idempotency_key (idempotency_key);
