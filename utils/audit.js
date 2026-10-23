const db = require('../config/database');

function logAudit(req, action, entityType, entityId, details, callback) {
  const user = req.session.user;
  db.run(
    `INSERT INTO audit_logs
      (actor_user_id, actor_role, department_id, action, entity_type, entity_id, details)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      user.id,
      user.role,
      user.departmentId,
      action,
      entityType,
      entityId || null,
      details ? JSON.stringify(details) : null
    ],
    callback
  );
}

module.exports = logAudit;
