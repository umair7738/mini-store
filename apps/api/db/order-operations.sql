ALTER TABLE orders
  ADD COLUMN status ENUM('placed', 'processing', 'completed', 'cancelled') NOT NULL DEFAULT 'placed' AFTER total_fils,
  ADD COLUMN status_updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) AFTER status;
