CREATE TABLE IF NOT EXISTS products (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(120) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  description TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS product_variants (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  product_id INT UNSIGNED NOT NULL,
  variant_key VARCHAR(80) NOT NULL,
  label VARCHAR(100) NOT NULL,
  attributes JSON NULL,
  sku VARCHAR(64) NOT NULL UNIQUE,
  price_fils INT UNSIGNED NOT NULL,
  stock INT UNSIGNED NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT fk_variants_product FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT uq_variant_key UNIQUE (product_id, variant_key),
  CONSTRAINT chk_variant_price CHECK (price_fils > 0),
  INDEX idx_variants_product (product_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS carts (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  token_hash BINARY(32) NOT NULL UNIQUE,
  status ENUM('active', 'checked_out', 'expired') NOT NULL DEFAULT 'active',
  expires_at DATETIME(6) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS cart_items (
  cart_id INT UNSIGNED NOT NULL,
  variant_id INT UNSIGNED NOT NULL,
  quantity TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (cart_id, variant_id),
  CONSTRAINT fk_cart_items_cart FOREIGN KEY (cart_id) REFERENCES carts(id),
  CONSTRAINT fk_cart_items_variant FOREIGN KEY (variant_id) REFERENCES product_variants(id),
  CONSTRAINT chk_cart_quantity CHECK (quantity BETWEEN 1 AND 99)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS orders (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  cart_id INT UNSIGNED NOT NULL UNIQUE,
  customer_name VARCHAR(120) NOT NULL,
  customer_email VARCHAR(254) NOT NULL,
  customer_phone VARCHAR(30) NULL,
  customer_address VARCHAR(500) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'AED',
  total_fils BIGINT UNSIGNED NOT NULL,
  idempotency_key VARCHAR(128) NULL,
  status ENUM('placed', 'processing', 'shipped', 'delivered', 'completed', 'cancelled') NOT NULL DEFAULT 'placed',
  status_updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  carrier VARCHAR(80) NULL,
  tracking_number VARCHAR(120) NULL,
  tracking_url VARCHAR(500) NULL,
  refund_status ENUM('none', 'pending', 'completed') NOT NULL DEFAULT 'none',
  refund_note VARCHAR(500) NULL,
  refund_updated_at DATETIME(6) NULL,
  confirmation_token_hash BINARY(32) NOT NULL,
  confirmation_expires_at DATETIME(6) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_orders_cart FOREIGN KEY (cart_id) REFERENCES carts(id),
  CONSTRAINT uq_orders_idempotency_key UNIQUE (idempotency_key)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS order_events (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id INT UNSIGNED NOT NULL,
  event_type VARCHAR(40) NOT NULL,
  message VARCHAR(200) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_order_events_order FOREIGN KEY (order_id) REFERENCES orders(id),
  INDEX idx_order_events_order (order_id, id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS order_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id INT UNSIGNED NOT NULL,
  variant_id INT UNSIGNED NOT NULL,
  product_name VARCHAR(120) NOT NULL,
  variant_key VARCHAR(80) NOT NULL,
  variant_label VARCHAR(100) NOT NULL,
  variant_attributes JSON NULL,
  sku VARCHAR(64) NOT NULL,
  unit_price_fils INT UNSIGNED NOT NULL,
  quantity TINYINT UNSIGNED NOT NULL,
  CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_order_items_variant FOREIGN KEY (variant_id) REFERENCES product_variants(id),
  INDEX idx_order_items_order (order_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS admin_users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(254) NOT NULL UNIQUE,
  password_hash VARCHAR(200) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash BINARY(32) PRIMARY KEY,
  admin_user_id INT UNSIGNED NOT NULL,
  expires_at DATETIME(6) NOT NULL,
  CONSTRAINT fk_admin_sessions_user FOREIGN KEY (admin_user_id) REFERENCES admin_users(id),
  INDEX idx_admin_sessions_expires (expires_at)
) ENGINE=InnoDB;
