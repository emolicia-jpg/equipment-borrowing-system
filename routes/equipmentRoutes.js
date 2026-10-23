const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { isAuthenticated, authorizeRoles } = require('../middleware/auth');
const logAudit = require('../utils/audit');

function departmentScope(user, column) {
  return user.role === 'admin' ? { sql: '', params: [] } : {
    sql: ` AND ${column} = ?`,
    params: [user.departmentId]
  };
}

function isValidDateTime(value) {
  const match = typeof value === 'string'
    ? /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(value)
    : null;
  if (!match) return false;
  const date = new Date(`${match[1]}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === match[1] &&
    Number(match[2]) <= 23 && Number(match[3]) <= 59;
}

router.get('/availability', isAuthenticated, authorizeRoles('student', 'faculty'), async (req, res) => {
  const start = typeof req.query.start_datetime === 'string' ? req.query.start_datetime : '';
  const due = typeof req.query.due_datetime === 'string' ? req.query.due_datetime : '';
  if (!isValidDateTime(start) || !isValidDateTime(due) || start > due) {
    return res.status(400).json({ message: 'Enter a valid borrowing schedule.' });
  }
  try {
    const [equipment] = await db.query(
      `SELECT equipment.id, equipment.name,
        GREATEST(equipment.total_quantity - COALESCE(SUM(requests.quantity), 0), 0) AS available_qty
       FROM equipment
       LEFT JOIN borrow_requests requests
         ON requests.equipment_id = equipment.id
         AND LOWER(requests.status) IN ('pending', 'approved', 'borrowed')
         AND (
           (LOWER(requests.status) = 'borrowed'
             AND TIMESTAMP(requests.requested_start_date, requests.requested_start_time) <= ?)
           OR (LOWER(requests.status) IN ('pending', 'approved')
             AND TIMESTAMP(requests.requested_start_date, requests.requested_start_time) <= ?
             AND TIMESTAMP(requests.requested_due_date, requests.requested_due_time) >= ?)
         )
       WHERE equipment.department_id = ? AND equipment.status = 'Available'
       GROUP BY equipment.id, equipment.name, equipment.total_quantity
       HAVING available_qty > 0
       ORDER BY equipment.name`,
      [
        `${due.replace('T', ' ')}:00`,
        `${due.replace('T', ' ')}:00`,
        `${start.replace('T', ' ')}:00`,
        req.session.user.departmentId
      ]
    );
    res.json(equipment);
  } catch (err) {
    console.error('Unable to check schedule availability:', err);
    res.status(500).json({ message: 'Unable to check equipment availability right now.' });
  }
});

router.get('/', isAuthenticated, (req, res) => {
  const scope = departmentScope(req.session.user, 'equipment.department_id');
  db.all(
    `SELECT equipment.*, equipment.total_quantity AS total_qty, departments.code AS department_code
     FROM equipment JOIN departments ON departments.id = equipment.department_id
     WHERE 1 = 1${scope.sql} ORDER BY equipment.name`,
    scope.params,
    (err, equipmentList) => {
      if (err) {
        console.error('Unable to load equipment inventory:', err);
        return res.status(500).send('Unable to load equipment inventory.');
      }

      const renderPage = (departments) => {
        const status = req.query.status;
        const messages = {
          added: { success: 'Equipment was added to the inventory.' },
          updated: { success: 'Equipment status was updated.' },
          deleted: { success: 'Equipment was deleted from the inventory.' },
          invalid: { error: 'Enter an item name, category, and a quantity greater than zero.' },
          'save-failed': { error: 'The item could not be saved. Check the server log for the database error and try again.' },
          'delete-invalid': { error: 'Select a valid equipment item to delete.' },
          'delete-not-found': { error: 'That equipment item no longer exists.' },
          'delete-in-use': { error: 'This equipment cannot be deleted because it has borrowing request history.' },
          'delete-check-failed': { error: 'The equipment request history could not be checked. Try again.' },
          'delete-failed': { error: 'The equipment item could not be deleted. Check the server log for the database error and try again.' }
        };
        const feedback = messages[status] || {};
        res.render('equipment', {
          user: req.session.user,
          equipment: equipmentList,
          departments,
          error: feedback.error || null,
          success: feedback.success || null
        });
      };

      if (req.session.user.role !== 'admin') return renderPage([]);
      db.all('SELECT id, code, name FROM departments ORDER BY name', [], (departmentError, departments) => {
        if (departmentError) {
          console.error('Unable to load department options:', departmentError);
          return res.status(500).send('Unable to load equipment management.');
        }
        renderPage(departments);
      });
    }
  );
});

router.post('/add', isAuthenticated, authorizeRoles('admin', 'department_admin', 'custodian'), (req, res) => {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  const category = typeof req.body.category === 'string' ? req.body.category.trim() : '';
  const totalQty = Number(req.body.total_qty);
  const departmentId = req.session.user.role === 'admin'
    ? Number(req.body.department_id)
    : req.session.user.departmentId;
  if (!name || name.length > 150 || !category || category.length > 80 ||
      !Number.isSafeInteger(totalQty) || totalQty < 1 ||
      !Number.isSafeInteger(departmentId) || departmentId < 1) {
    return res.redirect('/equipment?status=invalid');
  }

  db.run(
    'INSERT INTO equipment (name, category, total_quantity, available_qty, `condition`, status, department_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [name, category, totalQty, totalQty, 'Good', 'Available', departmentId],
    function (err) {
      if (err) {
        console.error('Unable to save equipment item:', err);
        return res.redirect('/equipment?status=save-failed');
      }
      logAudit(req, 'equipment.created', 'equipment', this.lastID, { name, departmentId }, (auditError) => {
        if (auditError) {
          console.error('Unable to record equipment creation:', auditError);
          return res.status(500).send('Equipment was added, but its audit record could not be saved.');
        }
        res.redirect('/equipment?status=added');
      });
    }
  );
});

router.post('/status/:id', isAuthenticated, authorizeRoles('admin', 'department_admin', 'custodian'), (req, res) => {
  const equipmentId = Number(req.params.id);
  const status = typeof req.body.status === 'string' ? req.body.status : '';
  const condition = typeof req.body.condition === 'string' ? req.body.condition : '';
  if (!Number.isSafeInteger(equipmentId) || equipmentId < 1 || !['Available', 'Maintenance', 'Retired'].includes(status) ||
      !['Good', 'Damaged'].includes(condition) || (status === 'Available' && condition !== 'Good')) {
    return res.status(400).send('Select a valid equipment item and status.');
  }
  const scope = departmentScope(req.session.user, 'equipment.department_id');
  db.get(
    `SELECT equipment.id, equipment.status, equipment.\`condition\`,
      equipment.available_qty, equipment.total_quantity AS total_qty,
      COALESCE(SUM(CASE WHEN LOWER(requests.status) = 'borrowed' THEN requests.quantity ELSE 0 END), 0) AS borrowed_qty
     FROM equipment
     LEFT JOIN borrow_requests requests ON requests.equipment_id = equipment.id
     WHERE equipment.id = ?${scope.sql}
     GROUP BY equipment.id, equipment.status, equipment.\`condition\`,
       equipment.available_qty, equipment.total_quantity`,
    [equipmentId, ...scope.params],
    (err, item) => {
      if (err) {
        console.error('Unable to check equipment status:', err);
        return res.status(500).send('Unable to update equipment status.');
      }
      if (!item) return res.status(404).send('Equipment item not found in your department.');
      if ((status === 'Maintenance' || status === 'Retired') &&
          Number(item.available_qty) !== Number(item.total_qty)) {
        return res.status(409).send('Return all borrowed units before changing this equipment status.');
      }
      const nextStatus = condition === 'Damaged' ? 'Maintenance' : status;
      const repairedQuantity = condition === 'Good' && item.condition === 'Damaged'
        ? Math.max(0, Number(item.total_qty) - Number(item.available_qty) - Number(item.borrowed_qty))
        : 0;
      db.run(
        'UPDATE equipment SET status = ?, `condition` = ?, available_qty = available_qty + ? WHERE id = ?',
        [nextStatus, condition, repairedQuantity, equipmentId],
        (updateError) => {
        if (updateError) {
          console.error('Unable to update equipment status:', updateError);
          return res.status(500).send('Unable to update equipment status.');
        }
        logAudit(req, 'equipment.status_updated', 'equipment', equipmentId, { status: nextStatus, condition }, (auditError) => {
          if (auditError) {
            console.error('Unable to record equipment status update:', auditError);
            return res.status(500).send('Equipment status was updated, but its audit record could not be saved.');
          }
          res.redirect('/equipment?status=updated');
        });
      }
      );
    }
  );
});

router.post('/delete/:id', isAuthenticated, authorizeRoles('admin', 'department_admin'), (req, res) => {
  const equipmentId = Number(req.params.id);
  if (!Number.isSafeInteger(equipmentId) || equipmentId < 1) {
    return res.redirect('/equipment?status=delete-invalid');
  }

  const scope = departmentScope(req.session.user, 'equipment.department_id');
  db.get(
    `SELECT COUNT(requests.id) AS request_count
     FROM equipment
     LEFT JOIN borrow_requests requests ON requests.equipment_id = equipment.id
     WHERE equipment.id = ?${scope.sql}`,
    [equipmentId, ...scope.params],
    (err, result) => {
    if (err) {
      console.error('Unable to check equipment request history:', err);
      return res.redirect('/equipment?status=delete-check-failed');
    }
    if (!result || result.request_count === null) return res.redirect('/equipment?status=delete-not-found');
    if (Number(result.request_count) > 0) {
      return res.redirect('/equipment?status=delete-in-use');
    }

    db.run(`DELETE FROM equipment WHERE id = ?${scope.sql}`, [equipmentId, ...scope.params], function (deleteError) {
      if (deleteError) {
        if (deleteError.code === 'ER_ROW_IS_REFERENCED_2' || deleteError.code === 'ER_ROW_IS_REFERENCED') {
          return res.redirect('/equipment?status=delete-in-use');
        }
        console.error('Unable to delete equipment item:', deleteError);
        return res.redirect('/equipment?status=delete-failed');
      }
      if (this.changes === 0) return res.redirect('/equipment?status=delete-not-found');
      logAudit(req, 'equipment.deleted', 'equipment', equipmentId, null, (auditError) => {
        if (auditError) {
          console.error('Unable to record equipment deletion:', auditError);
          return res.status(500).send('Equipment was deleted, but its audit record could not be saved.');
        }
        res.redirect('/equipment?status=deleted');
      });
    }
    );
  });
});

module.exports = router;
