const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { isAuthenticated, authorizeRoles } = require('../middleware/auth');

// FR-1: Browse equipment and view real-time availability
router.get('/', isAuthenticated, (req, res) => {
  db.all('SELECT * FROM equipment', [], (err, equipmentList) => {
    if (err) {
      console.error('Unable to load equipment inventory:', err);
      return res.status(500).send('Database error.');
    }
    const status = req.query.status;
    const messages = {
      added: { success: 'Equipment was added to the inventory.' },
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
      error: feedback.error || null,
      success: feedback.success || null
    });
  });
});

// Add Equipment (Admin/Custodian only)
router.post('/add', isAuthenticated, authorizeRoles('admin', 'custodian'), (req, res) => {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  const category = typeof req.body.category === 'string' ? req.body.category.trim() : '';
  const totalQty = Number(req.body.total_qty);
  const condition = typeof req.body.condition === 'string' && req.body.condition.trim()
    ? req.body.condition.trim()
    : 'Good';

  if (!name || !category || !Number.isSafeInteger(totalQty) || totalQty < 1) {
    return res.redirect('/equipment?status=invalid');
  }

  db.run(
    'INSERT INTO equipment (name, category, total_qty, available_qty, `condition`) VALUES (?, ?, ?, ?, ?)',
    [name, category, totalQty, totalQty, condition],
    (err) => {
      if (err) {
        console.error('Unable to save equipment item:', err);
        return res.redirect('/equipment?status=save-failed');
      }
      res.redirect('/equipment?status=added');
    }
  );
});

// Delete Equipment (Admin only); retain equipment referenced by borrowing history.
router.post('/delete/:id', isAuthenticated, authorizeRoles('admin'), (req, res) => {
  const equipmentId = Number(req.params.id);
  if (!Number.isSafeInteger(equipmentId) || equipmentId < 1) {
    return res.redirect('/equipment?status=delete-invalid');
  }

  db.get('SELECT COUNT(*) AS request_count FROM requests WHERE equipment_id = ?', [equipmentId], (err, result) => {
    if (err) {
      console.error('Unable to check equipment request history:', err);
      return res.redirect('/equipment?status=delete-check-failed');
    }
    if (Number(result.request_count) > 0) {
      return res.redirect('/equipment?status=delete-in-use');
    }

    db.run('DELETE FROM equipment WHERE id = ?', [equipmentId], function (deleteError) {
      if (deleteError) {
        if (deleteError.code === 'ER_ROW_IS_REFERENCED_2' || deleteError.code === 'ER_ROW_IS_REFERENCED') {
          return res.redirect('/equipment?status=delete-in-use');
        }
        console.error('Unable to delete equipment item:', deleteError);
        return res.redirect('/equipment?status=delete-failed');
      }
      if (this.changes === 0) {
        return res.redirect('/equipment?status=delete-not-found');
      }
      res.redirect('/equipment?status=deleted');
    });
  });
});

module.exports = router;