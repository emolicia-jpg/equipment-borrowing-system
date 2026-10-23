USE equipment_borrowing_system;

ALTER TABLE borrow_requests
  ADD COLUMN requested_start_time TIME NOT NULL DEFAULT '00:00:00',
  ADD COLUMN requested_due_time TIME NOT NULL DEFAULT '23:59:00',
  ADD COLUMN decision_note TEXT NULL,
  ADD INDEX idx_borrow_requests_equipment_schedule_status
    (equipment_id, status, requested_start_date, requested_due_date);

CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  request_id INT NULL,
  notification_type VARCHAR(40) NOT NULL,
  message VARCHAR(500) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at TIMESTAMP NULL DEFAULT NULL,
  INDEX idx_notifications_user_unread (user_id, read_at, created_at),
  INDEX idx_notifications_request_type (request_id, notification_type),
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_notifications_request FOREIGN KEY (request_id)
    REFERENCES borrow_requests(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
