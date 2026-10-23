USE equipment_borrowing_system;

ALTER TABLE users
  MODIFY COLUMN role ENUM(
    'student',
    'faculty',
    'custodian',
    'coordinator',
    'property',
    'dean',
    'admin',
    'security',
    'department_admin'
  ) NOT NULL DEFAULT 'student';
