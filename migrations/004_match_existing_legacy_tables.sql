USE equipment_borrowing_system;

CREATE TABLE IF NOT EXISTS departments (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO departments (code, name) VALUES
  ('CAS', 'College of Arts and Sciences'),
  ('CCS', 'College of Computer Studies'),
  ('CEA', 'College of Engineering and Architecture'),
  ('CHS', 'College of Health Sciences'),
  ('CTDE', 'College of Technological and Developmental Education'),
  ('CTHBM', 'College of Tourism, Hospitality and Business Management'),
  ('GS', 'Graduate School')
ON DUPLICATE KEY UPDATE name = VALUES(name);

ALTER TABLE users
  MODIFY COLUMN role ENUM('student', 'faculty', 'custodian', 'coordinator', 'property', 'dean', 'admin', 'security')
    NOT NULL DEFAULT 'student',
  ADD COLUMN department_id INT NULL;

ALTER TABLE equipment
  MODIFY COLUMN status VARCHAR(20) NOT NULL DEFAULT 'Available',
  ADD COLUMN department_id INT NULL,
  ADD COLUMN available_qty INT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN `condition` VARCHAR(40) NOT NULL DEFAULT 'Good';

ALTER TABLE borrow_requests
  MODIFY COLUMN status VARCHAR(32) NOT NULL DEFAULT 'pending',
  ADD COLUMN department_id INT NULL,
  ADD COLUMN pre_condition VARCHAR(100) NULL,
  ADD COLUMN post_condition VARCHAR(100) NULL;

UPDATE users
SET department_id = (SELECT id FROM departments WHERE code = 'CCS')
WHERE department_id IS NULL;

UPDATE equipment
SET department_id = (SELECT id FROM departments WHERE code = 'CCS')
WHERE department_id IS NULL;

UPDATE equipment equipment_item
SET available_qty = GREATEST(
      equipment_item.total_quantity - COALESCE((
        SELECT SUM(request.quantity)
        FROM borrow_requests request
        WHERE request.equipment_id = equipment_item.id
          AND LOWER(request.status) = 'borrowed'
      ), 0),
      0
    ),
    status = CASE LOWER(equipment_item.status)
      WHEN 'maintenance' THEN 'Maintenance'
      WHEN 'retired' THEN 'Retired'
      ELSE 'Available'
    END;

UPDATE borrow_requests request
LEFT JOIN users borrower ON borrower.id = request.user_id
LEFT JOIN equipment equipment_item ON equipment_item.id = request.equipment_id
SET request.department_id = COALESCE(
  borrower.department_id,
  equipment_item.department_id,
  (SELECT id FROM departments WHERE code = 'CCS')
)
WHERE request.department_id IS NULL;

ALTER TABLE users
  MODIFY COLUMN department_id INT NOT NULL,
  ADD INDEX idx_users_department (department_id),
  ADD CONSTRAINT fk_users_department FOREIGN KEY (department_id) REFERENCES departments(id);

ALTER TABLE equipment
  MODIFY COLUMN department_id INT NOT NULL,
  ADD INDEX idx_equipment_department (department_id),
  ADD CONSTRAINT fk_equipment_department FOREIGN KEY (department_id) REFERENCES departments(id);

ALTER TABLE borrow_requests
  MODIFY COLUMN department_id INT NOT NULL,
  ADD INDEX idx_borrow_requests_department_status (department_id, status),
  ADD CONSTRAINT fk_borrow_requests_department FOREIGN KEY (department_id) REFERENCES departments(id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  actor_user_id INT NULL,
  actor_role VARCHAR(32) NOT NULL,
  department_id INT NULL,
  action VARCHAR(80) NOT NULL,
  entity_type VARCHAR(40) NOT NULL,
  entity_id BIGINT NULL,
  details TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_logs_created_at (created_at),
  INDEX idx_audit_logs_department (department_id),
  CONSTRAINT fk_audit_logs_department FOREIGN KEY (department_id) REFERENCES departments(id)
);
