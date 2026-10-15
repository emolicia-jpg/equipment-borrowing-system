const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { isAuthenticated, authorizeRoles } = require('../middleware/auth');

// View requests
router.get('/', isAuthenticated, (req, res) => {
  let query = `
    SELECT requests.*, users.name as borrower_name, equipment.name as equipment_name 
    FROM requests 
    JOIN users ON requests.user_id = users.id 
    JOIN equipment ON requests.equipment_id = equipment.id
  `;
  const params = [];

  // Regular users see only their own requests
  if (req.session.user.role === 'student' || req.session.user.role === 'faculty') {
    query += ' WHERE requests.user_id = ?';
    params.push(req.session.user.id);
  }

  db.all(query, params, (err, requestsList) => {
    if (err) return res.status(500).send('Database Error');
    
    db.all('SELECT * FROM equipment WHERE available_qty > 0', [], (err, availableEq) => {
      if (err) return res.status(500).send('Database Error');

      res.render('request', {
        user: req.session.user,
        requests: requestsList,
        equipmentList: availableEq,
        error: null
      });
    });
  });
});

// FR-2 & FR-3: Submit Borrow Request with Availability Validation
router.post('/submit', isAuthenticated, (req, res) => {
  const { equipment_id, purpose, quantity, borrow_date, return_date } = req.body;
  const qtyNum = parseInt(quantity);

  db.get('SELECT available_qty FROM equipment WHERE id = ?', [equipment_id], (err, eq) => {
    if (err || !eq) return res.redirect('/requests');

    // FR-3: Prevent request if insufficient quantity
    if (eq.available_qty < qtyNum) {
      return res.status(400).send('Requested quantity exceeds current equipment availability.');
    }

    db.run(
      `INSERT INTO requests (user_id, equipment_id, purpose, quantity, borrow_date, return_date, status) 
       VALUES (?, ?, ?, ?, ?, ?, 'Pending')`,
      [req.session.user.id, equipment_id, purpose, qtyNum, borrow_date, return_date],
      (err) => {
        res.redirect('/requests');
      }
    );
  });
});

// FR-4 & FR-5: Approve & Release Request
router.post('/approve/:id', isAuthenticated, authorizeRoles('custodian', 'admin'), (req, res) => {
  const requestId = req.params.id;

  db.get('SELECT * FROM requests WHERE id = ?', [requestId], (err, reqRecord) => {
    if (err || !reqRecord || reqRecord.status !== 'Pending') return res.redirect('/requests');

    db.get('SELECT available_qty FROM equipment WHERE id = ?', [reqRecord.equipment_id], (err, eq) => {
      if (eq.available_qty < reqRecord.quantity) {
        return res.status(400).send('Cannot approve: Insufficient stock available.');
      }

      // Update available stock
      db.run('UPDATE equipment SET available_qty = available_qty - ? WHERE id = ?', [reqRecord.quantity, reqRecord.equipment_id]);

      // Update request status to Borrowed
      db.run("UPDATE requests SET status = 'Borrowed', pre_condition = 'Checked Good' WHERE id = ?", [requestId], () => {
        res.redirect('/requests');
      });
    });
  });
});

// FR-6: Record Return
router.post('/return/:id', isAuthenticated, authorizeRoles('custodian', 'admin'), (req, res) => {
  const requestId = req.params.id;
  const { post_condition } = req.body;

  db.get('SELECT * FROM requests WHERE id = ?', [requestId], (err, reqRecord) => {
    if (err || !reqRecord || reqRecord.status !== 'Borrowed') return res.redirect('/requests');

    // Restock equipment
    db.run('UPDATE equipment SET available_qty = available_qty + ? WHERE id = ?', [reqRecord.quantity, reqRecord.equipment_id]);

    // Set request status to Returned
    db.run("UPDATE requests SET status = 'Returned', post_condition = ? WHERE id = ?", [post_condition || 'Returned Good', requestId], () => {
      res.redirect('/requests');
    });
  });
});

module.exports = router;