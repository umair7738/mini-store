ALTER TABLE orders
  MODIFY COLUMN status ENUM('placed', 'processing', 'shipped', 'delivered', 'completed', 'cancelled') NOT NULL DEFAULT 'placed',
  ADD COLUMN carrier VARCHAR(80) NULL AFTER status_updated_at,
  ADD COLUMN tracking_number VARCHAR(120) NULL AFTER carrier,
  ADD COLUMN tracking_url VARCHAR(500) NULL AFTER tracking_number;

CREATE TABLE IF NOT EXISTS order_events (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id INT UNSIGNED NOT NULL,
  event_type VARCHAR(40) NOT NULL,
  message VARCHAR(200) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_order_events_order FOREIGN KEY (order_id) REFERENCES orders(id),
  INDEX idx_order_events_order (order_id, id)
) ENGINE=InnoDB;

INSERT INTO order_events (order_id, event_type, message, created_at)
SELECT o.id, o.status, 'Order status recorded', o.status_updated_at
FROM orders o
WHERE NOT EXISTS (
  SELECT 1 FROM order_events e WHERE e.order_id = o.id
);
