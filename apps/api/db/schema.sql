CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(128) PRIMARY KEY,
  applied_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS products (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(120) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  description TEXT NOT NULL,
  image_url VARCHAR(500) NULL,
  images JSON NULL,
  sku VARCHAR(64) NOT NULL UNIQUE,
  price_fils INT UNSIGNED NOT NULL,
  stock INT UNSIGNED NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
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
  product_id INT UNSIGNED NOT NULL,
  quantity TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (cart_id, product_id),
  CONSTRAINT fk_cart_items_cart FOREIGN KEY (cart_id) REFERENCES carts(id),
  CONSTRAINT fk_cart_items_product FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT chk_cart_quantity CHECK (quantity BETWEEN 1 AND 20)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS orders (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(36) NOT NULL,
  customer_id INT UNSIGNED NULL,
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
  CONSTRAINT uq_orders_idempotency_key UNIQUE (idempotency_key),
  CONSTRAINT uq_orders_public_id UNIQUE (public_id)
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
  product_id INT UNSIGNED NULL,
  product_name VARCHAR(120) NOT NULL,
  sku VARCHAR(64) NOT NULL,
  unit_price_fils INT UNSIGNED NOT NULL,
  quantity TINYINT UNSIGNED NOT NULL,
  CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_order_items_product FOREIGN KEY (product_id) REFERENCES products(id),
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

CREATE TABLE IF NOT EXISTS customers (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(254) NOT NULL UNIQUE,
  password_hash VARCHAR(200) NOT NULL,
  full_name VARCHAR(120) NOT NULL,
  phone VARCHAR(30) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS customer_sessions (
  token_hash BINARY(32) PRIMARY KEY,
  customer_id INT UNSIGNED NOT NULL,
  expires_at DATETIME(6) NOT NULL,
  CONSTRAINT fk_customer_sessions_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  INDEX idx_customer_sessions_expiry (expires_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS customer_addresses (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_id INT UNSIGNED NOT NULL,
  label VARCHAR(60) NOT NULL DEFAULT 'Home',
  recipient_name VARCHAR(120) NOT NULL,
  phone VARCHAR(30) NOT NULL,
  address VARCHAR(500) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_customer_addresses_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  INDEX idx_customer_addresses_customer (customer_id, id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS guest_sessions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  token_hash BINARY(32) NOT NULL UNIQUE,
  expires_at DATETIME(6) NOT NULL,
  revoked_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  INDEX idx_guest_sessions_expiry (expires_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS guest_session_orders (
  guest_session_id INT UNSIGNED NOT NULL,
  order_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (guest_session_id, order_id),
  CONSTRAINT fk_guest_session_orders_session FOREIGN KEY (guest_session_id) REFERENCES guest_sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_guest_session_orders_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  INDEX idx_guest_session_orders_order (order_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS order_recovery_tokens (
  token_hash BINARY(32) PRIMARY KEY,
  order_id INT UNSIGNED NOT NULL,
  expires_at DATETIME(6) NOT NULL,
  used_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_order_recovery_tokens_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  INDEX idx_order_recovery_tokens_expiry (expires_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS checkout_idempotency_keys (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  idempotency_key VARCHAR(128) NOT NULL UNIQUE,
  mode ENUM('cart', 'buy_now', 'legacy') NOT NULL,
  customer_id INT UNSIGNED NULL,
  guest_session_id INT UNSIGNED NULL,
  cart_id INT UNSIGNED NULL,
  order_id INT UNSIGNED NULL,
  immutable_fingerprint BINARY(32) NULL,
  items_snapshot JSON NULL,
  status ENUM('in_progress', 'processing', 'completed', 'failed', 'uncertain', 'legacy') NOT NULL DEFAULT 'in_progress',
  claim_hash BINARY(32) NULL,
  lease_until DATETIME(6) NULL,
  error_code VARCHAR(64) NULL,
  expires_at DATETIME(6) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_checkout_idempotency_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_checkout_idempotency_guest FOREIGN KEY (guest_session_id) REFERENCES guest_sessions(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_checkout_idempotency_cart FOREIGN KEY (cart_id) REFERENCES carts(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_checkout_idempotency_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  INDEX idx_checkout_idempotency_expiry (expires_at),
  INDEX idx_checkout_idempotency_cart_status (cart_id, status),
  INDEX idx_checkout_idempotency_order (order_id)
) ENGINE=InnoDB;
