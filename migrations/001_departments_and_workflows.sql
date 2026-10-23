CREATE TABLE departments (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO departments (code, name) VALUES
  ('CCS', 'College of Computer Studies'),
  ('CEA', 'College of Engineering and Architecture'),
  ('CAS', 'College of Arts and Sciences');

ALTER TABLE users
  MODIFY COLUMN role ENUM('student', 'faculty', 'custodian', 'coordinator', 'property', 'dean', 'admin', 'security')
  NOT NULL DEFAULT 'student';

ALTER TABLE users ADD COLUMN department_id INT NULL;
ALTER TABLE equipment ADD COLUMN department_id INT NULL;
ALTER TABLE requests ADD COLUMN department_id INT NULL;
ALTER TABLE equipment ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'Available';
ALTER TABLE requests MODIFY COLUMN status VARCHAR(32) NOT NULL DEFAULT 'Pending';

UPDATE users
SET department_id = (SELECT id FROM departments WHERE code = 'CCS')
WHERE department_id IS NULL;

UPDATE equipment
SET department_id = (SELECT id FROM departments WHERE code = 'CCS')
WHERE department_id IS NULL;

UPDATE requests
JOIN equipment ON equipment.id = requests.equipment_id
SET requests.department_id = equipment.department_id
WHERE requests.department_id IS NULL;

ALTER TABLE users MODIFY department_id INT NOT NULL;
ALTER TABLE equipment MODIFY department_id INT NOT NULL;
ALTER TABLE requests MODIFY department_id INT NOT NULL;

ALTER TABLE users
  ADD CONSTRAINT fk_users_department FOREIGN KEY (department_id) REFERENCES departments(id),
  ADD INDEX idx_users_department (department_id);

ALTER TABLE equipment
  ADD CONSTRAINT fk_equipment_department FOREIGN KEY (department_id) REFERENCES departments(id),
  ADD INDEX idx_equipment_department (department_id);

ALTER TABLE requests
  ADD CONSTRAINT fk_requests_department FOREIGN KEY (department_id) REFERENCES departments(id),
  ADD INDEX idx_requests_department_status (department_id, status);

CREATE TABLE audit_logs (
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
