ALTER TABLE orders
  ADD COLUMN status ENUM('placed', 'processing', 'completed', 'cancelled') NOT NULL DEFAULT 'placed' AFTER total_fils,
  ADD COLUMN status_updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) AFTER status,
  ADD COLUMN refund_status ENUM('none', 'pending', 'completed') NOT NULL DEFAULT 'none' AFTER status_updated_at,
  ADD COLUMN refund_note VARCHAR(500) NULL AFTER refund_status,
  ADD COLUMN refund_updated_at DATETIME(6) NULL AFTER refund_note;
