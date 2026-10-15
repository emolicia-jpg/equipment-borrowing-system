const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { isAuthenticated, authorizeRoles } = require('../middleware/auth');

// FR-1: Browse equipment and view real-time availability
router.get('/', isAuthenticated, (req, res) => {
  db.all('SELECT * FROM equipment', [], (err, equipmentList) => {
    if (err) {
      return res.status(500).send('Database error.');
    }
    res.render('equipment', { user: req.session.user, equipment: equipmentList, error: null });
  });
});

// Add Equipment (Admin/Custodian only)
router.post('/add', isAuthenticated, authorizeRoles('admin', 'custodian'), (req, res) => {
  const { name, category, total_qty, condition } = req.body;

  if (!name || !category || !total_qty) {
    return res.redirect('/equipment');
  }

  db.run(
    'INSERT INTO equipment (name, category, total_qty, available_qty, condition) VALUES (?, ?, ?, ?, ?)',
    [name, category, total_qty, total_qty, condition || 'Good'],
    (err) => {
      res.redirect('/equipment');
    }
  );
});

module.exports = router;