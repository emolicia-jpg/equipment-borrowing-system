const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../config/database');
const { isAuthenticated, authorizeRoles } = require('../middleware/auth');
const logAudit = require('../utils/audit');

const router = express.Router();
const STAFF_ROLES = ['department_admin', 'custodian', 'dean', 'faculty', 'coordinator', 'property', 'security'];
const EMAIL_PATTERN = /^[^\s@]+@my\.cspc\.edu\.ph$/i;

function formatAuditDetails(rawDetails, action, entityId) {
  if (!rawDetails) {
    const summaries = {
      'equipment.deleted': `Equipment record #${entityId} deleted`,
      'request.rejected': `Borrowing request #${entityId} rejected`,
      'request.released': `Borrowing request #${entityId} approved and released`,
      'user.registered': `Account #${entityId} registered`,
      'user.provisioned': `Staff account #${entityId} created`
    };
    return summaries[action] || `No additional details for ${action}`;
  }

  let details;
  try {
    details = JSON.parse(rawDetails);
  } catch (err) {
    console.error('Unable to format audit details:', err);
    return rawDetails;
  }
  if (!details || typeof details !== 'object' || Array.isArray(details)) return String(details);

  const labels = {
    code: 'Code',
    condition: 'Condition',
    departmentId: 'Department ID',
    equipmentId: 'Equipment ID',
    name: 'Name',
    quantity: 'Quantity',
    role: 'Role',
    status: 'Status'
  };
  return Object.entries(details)
    .map(([key, value]) => `${labels[key] || key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`)
    .join(' · ');
}

function formatAuditTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return `${new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date)} PHT`;
}

router.use(isAuthenticated, authorizeRoles('admin'));

router.get('/', (req, res) => {
  db.all('SELECT id, code, name FROM departments ORDER BY name', [], (departmentError, departments) => {
    if (departmentError) {
      console.error('Unable to load department management:', departmentError);
      return res.status(500).send('Unable to load department management.');
    }

    db.all(
      `SELECT users.id, users.full_name AS name, users.email, users.role, departments.code AS department_code
       FROM users JOIN departments ON departments.id = users.department_id
       ORDER BY departments.code, users.full_name`,
      [],
      (userError, users) => {
        if (userError) {
          console.error('Unable to load account management:', userError);
          return res.status(500).send('Unable to load account management.');
        }

        db.all(
          `SELECT audit_logs.id, audit_logs.actor_role, audit_logs.action,
            audit_logs.entity_type, audit_logs.entity_id, audit_logs.details,
            audit_logs.created_at, departments.code AS department_code,
            users.full_name AS actor_name
           FROM audit_logs
           LEFT JOIN departments ON departments.id = audit_logs.department_id
           LEFT JOIN users ON users.id = audit_logs.actor_user_id
           ORDER BY audit_logs.created_at DESC LIMIT 100`,
          [],
          (auditError, auditLogs) => {
            if (auditError) {
              console.error('Unable to load global audit logs:', auditError);
              return res.status(500).send('Unable to load global audit logs.');
            }
            const formattedAuditLogs = auditLogs.map((entry) => ({
              ...entry,
              formattedTime: formatAuditTime(entry.created_at),
              isoTime: (entry.created_at instanceof Date ? entry.created_at : new Date(entry.created_at)).toISOString(),
              formattedDetails: formatAuditDetails(entry.details, entry.action, entry.entity_id)
            }));
            res.render('admin', {
              user: req.session.user,
              departments,
              users,
              auditLogs: formattedAuditLogs,
              status: req.query.status
            });
          }
        );
      }
    );
  });
});

router.post('/audit/:id/delete', (req, res) => {
  const auditId = Number(req.params.id);
  if (!Number.isSafeInteger(auditId) || auditId < 1) {
    return res.status(400).send('Select a valid history entry.');
  }

  db.get('SELECT id, action FROM audit_logs WHERE id = ?', [auditId], (lookupError, entry) => {
    if (lookupError) {
      console.error('Unable to find audit history entry:', lookupError);
      return res.status(500).send('Unable to delete the history entry.');
    }
    if (!entry) return res.status(404).send('That history entry no longer exists.');

    db.run('DELETE FROM audit_logs WHERE id = ?', [auditId], function (deleteError) {
      if (deleteError) {
        console.error('Unable to delete audit history entry:', deleteError);
        return res.status(500).send('Unable to delete the history entry.');
      }
      if (!this.changes) return res.status(404).send('That history entry no longer exists.');

      logAudit(req, 'audit.deleted', 'audit_log', auditId, {
        deletedAction: entry.action,
        deletedAuditId: auditId
      }, (auditError) => {
        if (auditError) {
          console.error('Unable to record audit history deletion:', auditError);
          return res.status(500).send('The history entry was deleted, but the deletion could not be recorded.');
        }
        res.redirect('/admin?status=history-deleted');
      });
    });
  });
});

router.post('/departments', (req, res) => {
  const code = typeof req.body.code === 'string' ? req.body.code.trim().toUpperCase() : '';
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (!/^[A-Z0-9-]{2,20}$/.test(code) || !name || name.length > 120) {
    return res.status(400).send('Enter a department code (2-20 letters, numbers, or hyphens) and a name.');
  }

  db.run('INSERT INTO departments (code, name) VALUES (?, ?)', [code, name], function (err) {
    if (err) {
      console.error('Unable to create department:', err);
      return res.status(409).send('Department could not be created. Check that its code and name are unique.');
    }
    logAudit(req, 'department.created', 'department', this.lastID, { code, name }, (auditError) => {
      if (auditError) {
        console.error('Unable to record department creation:', auditError);
        return res.status(500).send('The department was created, but its audit record could not be saved.');
      }
      res.redirect('/admin?status=department-created');
    });
  });
});

router.post('/departments/:id', (req, res) => {
  const departmentId = Number(req.params.id);
  const code = typeof req.body.code === 'string' ? req.body.code.trim().toUpperCase() : '';
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (!Number.isSafeInteger(departmentId) || departmentId < 1 || !/^[A-Z0-9-]{2,20}$/.test(code) || !name || name.length > 120) {
    return res.status(400).send('Enter a valid department, code, and name.');
  }

  db.run('UPDATE departments SET code = ?, name = ? WHERE id = ?', [code, name, departmentId], function (err) {
    if (err) {
      console.error('Unable to update department:', err);
      return res.status(409).send('Department could not be updated. Check that its code and name are unique.');
    }
    if (!this.changes) return res.status(404).send('Department not found.');
    logAudit(req, 'department.updated', 'department', departmentId, { code, name }, (auditError) => {
      if (auditError) {
        console.error('Unable to record department update:', auditError);
        return res.status(500).send('The department was updated, but its audit record could not be saved.');
      }
      res.redirect('/admin?status=department-updated');
    });
  });
});

router.post('/users', async (req, res) => {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const role = typeof req.body.role === 'string' ? req.body.role : '';
  const departmentId = Number(req.body.department_id);

  if (!name || name.length > 100 || !EMAIL_PATTERN.test(email) || password.length < 8 ||
      !STAFF_ROLES.includes(role) || !Number.isSafeInteger(departmentId) || departmentId < 1) {
    return res.status(400).send('Enter a valid CSPC email, name, password of at least 8 characters, staff role, and department.');
  }

  let passwordHash;
  try {
    passwordHash = await bcrypt.hash(password, 10);
  } catch (err) {
    console.error('Unable to secure provisioned account password:', err);
    return res.status(500).send('Unable to create the account right now.');
  }

  db.run(
    'INSERT INTO users (full_name, email, password_hash, role, department_id) VALUES (?, ?, ?, ?, ?)',
    [name, email, passwordHash, role, departmentId],
    function (err) {
      if (err) {
        console.error('Unable to provision staff account:', err);
        return res.status(409).send('Account could not be created. Check that its email is unique and its department exists.');
      }
      logAudit(req, 'user.provisioned', 'user', this.lastID, { role, departmentId }, (auditError) => {
        if (auditError) {
          console.error('Unable to record account provisioning:', auditError);
          return res.status(500).send('The account was created, but its audit record could not be saved.');
        }
        res.redirect('/admin?status=user-created');
      });
    }
  );
});

module.exports = router;
