const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { isAuthenticated, authorizeRoles } = require('../middleware/auth');
const logAudit = require('../utils/audit');
const { notifyUser } = require('../utils/notifications');

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parseDateTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const [date, time] = value.split('T');
  const [hour, minute] = time.split(':').map(Number);
  if (!isValidDate(date) || hour > 23 || minute > 59) return null;
  return { date, time: `${time}:00` };
}

function getPhtDateTime() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

function requestScope(user) {
  const clauses = [];
  const params = [];
  if (user.role !== 'admin') {
    clauses.push('requests.department_id = ?');
    params.push(user.departmentId);
  }
  if (user.role === 'student' || user.role === 'faculty') {
    clauses.push('requests.user_id = ?');
    params.push(user.id);
  } else if (user.role === 'security') {
    clauses.push("LOWER(requests.status) = 'borrowed'");
  }
  return { sql: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', params };
}

router.get('/', isAuthenticated, (req, res) => {
  const scope = requestScope(req.session.user);
  db.all(
    `SELECT requests.id, requests.user_id, requests.equipment_id, requests.department_id,
      requests.request_note AS purpose, requests.quantity,
      DATE_FORMAT(TIMESTAMP(requests.requested_start_date, requests.requested_start_time), '%b %e, %Y %h:%i %p') AS borrow_date,
      DATE_FORMAT(TIMESTAMP(requests.requested_due_date, requests.requested_due_time), '%b %e, %Y %h:%i %p') AS return_date,
      DATE_FORMAT(TIMESTAMP(requests.requested_start_date, requests.requested_start_time), '%Y-%m-%dT%H:%i') AS borrow_datetime,
      DATE_FORMAT(TIMESTAMP(requests.requested_due_date, requests.requested_due_time), '%Y-%m-%dT%H:%i') AS return_datetime,
      requests.pre_condition, requests.post_condition, requests.decision_note,
      CASE LOWER(requests.status)
        WHEN 'pending' THEN 'Pending' WHEN 'approved' THEN 'Approved'
        WHEN 'rejected' THEN 'Rejected' WHEN 'borrowed' THEN 'Borrowed'
        WHEN 'returned' THEN 'Returned' WHEN 'returned_for_correction' THEN 'Correction Required'
        ELSE requests.status
      END AS status,
      users.full_name AS borrower_name, equipment.name AS equipment_name,
      (LOWER(requests.status) = 'borrowed'
        AND TIMESTAMP(requests.requested_due_date, requests.requested_due_time) < CURRENT_TIMESTAMP) AS is_overdue
     FROM borrow_requests requests
     JOIN users ON requests.user_id = users.id
     JOIN equipment ON requests.equipment_id = equipment.id
     ${scope.sql}
     ORDER BY requests.id DESC`,
    scope.params,
    (err, requestsList) => {
      if (err) {
        console.error('Unable to load borrowing requests:', err);
        return res.status(500).send('Unable to load borrowing requests.');
      }

      const user = req.session.user;
      const loadEquipment = user.role === 'student' || user.role === 'faculty';

      function renderPage(availableEq) {
        const messages = {
          availability: 'That equipment is no longer available for the selected schedule. Choose another item or time.',
          corrected: 'Your corrected request was submitted.'
        };
        res.render('request', {
          user,
          requests: requestsList,
          equipmentList: availableEq,
          error: messages[req.query.notice] || null,
          todayDate: getPhtDateTime(),
          departmentName: user.departmentName
        });
      }

      if (!loadEquipment) return renderPage([]);
      db.all(
        `SELECT id, name, available_qty FROM equipment
         WHERE department_id = ? AND total_quantity > 0 AND status = 'Available'
         ORDER BY name`,
        [user.departmentId],
        (equipmentError, availableEq) => {
          if (equipmentError) {
            console.error('Unable to load available equipment:', equipmentError);
            return res.status(500).send('Unable to load available equipment.');
          }
          renderPage(availableEq);
        }
      );
    }
  );
});

router.post('/submit', isAuthenticated, authorizeRoles('student', 'faculty'), async (req, res) => {
  const equipmentId = Number(req.body.equipment_id);
  const quantity = Number(req.body.quantity);
  const purpose = typeof req.body.purpose === 'string' ? req.body.purpose.trim() : '';
  const borrowDateTime = parseDateTime(req.body.borrow_datetime);
  const returnDateTime = parseDateTime(req.body.return_datetime);

  if (!Number.isSafeInteger(equipmentId) || equipmentId < 1 || !Number.isSafeInteger(quantity) || quantity < 1 ||
      !purpose || purpose.length > 500 || !borrowDateTime || !returnDateTime ||
      req.body.borrow_datetime < getPhtDateTime() || req.body.borrow_datetime > req.body.return_datetime) {
    return res.status(400).send('Enter an equipment item, quantity, purpose, and valid schedule. The borrow time cannot be in the past, and the return time cannot be before it.');
  }

  let requestId;
  try {
    await db.transaction(async (connection) => {
      const [items] = await connection.query(
        `SELECT id, total_quantity FROM equipment
         WHERE id = ? AND department_id = ? AND status = 'Available'
         FOR UPDATE`,
        [equipmentId, req.session.user.departmentId]
      );
      const item = items[0];
      if (!item) throw new Error('EQUIPMENT_UNAVAILABLE');
      const [reservedRows] = await connection.query(
        `SELECT COALESCE(SUM(quantity), 0) AS reserved_qty
         FROM borrow_requests
         WHERE equipment_id = ?
           AND LOWER(status) IN ('pending', 'approved', 'borrowed')
           AND (
             (LOWER(status) = 'borrowed'
               AND TIMESTAMP(requested_start_date, requested_start_time) <= ?)
             OR (LOWER(status) IN ('pending', 'approved')
               AND TIMESTAMP(requested_start_date, requested_start_time) <= ?
               AND TIMESTAMP(requested_due_date, requested_due_time) >= ?)
           )`,
        [
          equipmentId,
          `${returnDateTime.date} ${returnDateTime.time}`,
          `${returnDateTime.date} ${returnDateTime.time}`,
          `${borrowDateTime.date} ${borrowDateTime.time}`
        ]
      );
      const reservedQty = Number(reservedRows[0].reserved_qty);
      if (Number(item.total_quantity) - reservedQty < quantity) throw new Error('INSUFFICIENT_SCHEDULE_STOCK');
      const [insertResult] = await connection.query(
        `INSERT INTO borrow_requests
          (user_id, equipment_id, department_id, request_note, quantity,
           requested_start_date, requested_start_time, requested_due_date,
           requested_due_time, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [
          req.session.user.id, equipmentId, req.session.user.departmentId, purpose, quantity,
          borrowDateTime.date, borrowDateTime.time, returnDateTime.date, returnDateTime.time
        ]
      );
      requestId = insertResult.insertId;
    });
  } catch (err) {
    if (err.message === 'EQUIPMENT_UNAVAILABLE') {
      return res.status(404).send('That equipment is not available in your department.');
    }
    if (err.message === 'INSUFFICIENT_SCHEDULE_STOCK') {
      return res.redirect('/requests?notice=availability');
    }
    console.error('Unable to submit borrowing request:', err);
    return res.status(500).send('Unable to save the borrowing request.');
  }

  try {
    await notifyUser(req.session.user.id, 'request_submitted', 'Your equipment request was submitted for review.', requestId);
  } catch (err) {
    console.error('Unable to notify the requester about submission:', err);
    return res.status(500).send('Request was submitted, but its notification could not be saved.');
  }
  logAudit(req, 'request.submitted', 'request', requestId, { equipmentId, quantity }, (auditError) => {
    if (auditError) {
      console.error('Unable to record borrowing request:', auditError);
      return res.status(500).send('Request was submitted, but its audit record could not be saved.');
    }
    res.redirect('/requests');
  });
});

router.post('/release/:id', isAuthenticated, authorizeRoles('admin', 'department_admin', 'custodian'), async (req, res) => {
  const requestId = Number(req.params.id);
  if (!Number.isSafeInteger(requestId) || requestId < 1) return res.status(400).send('Select a valid request.');

  let borrowerId;
  try {
    await db.transaction(async (connection) => {
      const scope = req.session.user.role === 'admin' ? '' : ' AND requests.department_id = ?';
      const params = req.session.user.role === 'admin'
        ? [requestId]
        : [requestId, req.session.user.departmentId];
      const [rows] = await connection.query(
        `SELECT id, user_id, equipment_id, department_id, quantity, status FROM borrow_requests requests
         WHERE id = ?${scope} FOR UPDATE`,
        params
      );
      const request = rows[0];
      if (!request || request.status.toLowerCase() !== 'pending') throw new Error('REQUEST_NOT_PENDING');
      borrowerId = request.user_id;

      const [stockResult] = await connection.query(
        `UPDATE equipment SET available_qty = available_qty - ?
         WHERE id = ? AND department_id = ? AND status = 'Available' AND available_qty >= ?`,
        [request.quantity, request.equipment_id, request.department_id, request.quantity]
      );
      if (!stockResult.affectedRows) throw new Error('INSUFFICIENT_STOCK');

      await connection.query(
        `UPDATE borrow_requests
         SET status = 'borrowed', pre_condition = 'Checked Good',
           approved_by = ?, approved_at = CURRENT_TIMESTAMP, borrowed_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [req.session.user.id, requestId]
      );
    });
  } catch (err) {
    if (err.message === 'REQUEST_NOT_PENDING') return res.status(409).send('This request is no longer pending.');
    if (err.message === 'INSUFFICIENT_STOCK') return res.status(409).send('Cannot release item: insufficient stock available.');
    console.error('Unable to release requested equipment:', err);
    return res.status(500).send('Unable to record equipment release.');
  }

  try {
    await notifyUser(borrowerId, 'request_released', 'Your request was approved and the equipment was released.', requestId);
  } catch (err) {
    console.error('Unable to notify borrower about equipment release:', err);
    return res.status(500).send('Equipment was released, but its notification could not be saved.');
  }
  logAudit(req, 'request.released', 'request', requestId, null, (auditError) => {
    if (auditError) {
      console.error('Unable to record equipment release:', auditError);
      return res.status(500).send('Equipment was released, but its audit record could not be saved.');
    }
    res.redirect('/requests');
  });
});

router.post('/reject/:id', isAuthenticated, authorizeRoles('admin', 'department_admin', 'custodian', 'coordinator'), async (req, res) => {
  const requestId = Number(req.params.id);
  const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
  if (!Number.isSafeInteger(requestId) || requestId < 1 || !reason || reason.length > 500) {
    return res.status(400).send('Enter a reason of no more than 500 characters to reject this request.');
  }
  let borrowerId;
  try {
    await db.transaction(async (connection) => {
      const scope = req.session.user.role === 'admin' ? '' : ' AND department_id = ?';
      const params = req.session.user.role === 'admin'
        ? [requestId]
        : [requestId, req.session.user.departmentId];
      const [rows] = await connection.query(
        `SELECT user_id, status FROM borrow_requests WHERE id = ?${scope} FOR UPDATE`,
        params
      );
      if (!rows.length || rows[0].status.toLowerCase() !== 'pending') throw new Error('REQUEST_NOT_PENDING');
      borrowerId = rows[0].user_id;
      await connection.query(
        "UPDATE borrow_requests SET status = 'rejected', decision_note = ? WHERE id = ?",
        [reason, requestId]
      );
    });
  } catch (err) {
    if (err.message === 'REQUEST_NOT_PENDING') return res.status(404).send('Pending request not found in your department.');
    console.error('Unable to reject borrowing request:', err);
    return res.status(500).send('Unable to reject the borrowing request.');
  }
  try {
    await notifyUser(borrowerId, 'request_rejected', `Your request was rejected: ${reason}`, requestId);
  } catch (err) {
    console.error('Unable to notify borrower about request rejection:', err);
    return res.status(500).send('Request was rejected, but its notification could not be saved.');
  }
  logAudit(req, 'request.rejected', 'request', requestId, { reason }, (auditError) => {
    if (auditError) {
      console.error('Unable to record request rejection:', auditError);
      return res.status(500).send('Request was rejected, but its audit record could not be saved.');
    }
    res.redirect('/requests');
  });
});

router.post('/return-for-correction/:id', isAuthenticated, authorizeRoles('admin', 'department_admin', 'custodian', 'coordinator'), async (req, res) => {
  const requestId = Number(req.params.id);
  const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
  if (!Number.isSafeInteger(requestId) || requestId < 1 || !reason || reason.length > 500) {
    return res.status(400).send('Enter a correction reason of no more than 500 characters.');
  }
  let borrowerId;
  try {
    await db.transaction(async (connection) => {
      const scope = req.session.user.role === 'admin' ? '' : ' AND department_id = ?';
      const params = req.session.user.role === 'admin'
        ? [requestId]
        : [requestId, req.session.user.departmentId];
      const [rows] = await connection.query(
        `SELECT user_id, status FROM borrow_requests WHERE id = ?${scope} FOR UPDATE`,
        params
      );
      if (!rows.length || rows[0].status.toLowerCase() !== 'pending') throw new Error('REQUEST_NOT_PENDING');
      borrowerId = rows[0].user_id;
      await connection.query(
        "UPDATE borrow_requests SET status = 'returned_for_correction', decision_note = ? WHERE id = ?",
        [reason, requestId]
      );
    });
  } catch (err) {
    if (err.message === 'REQUEST_NOT_PENDING') return res.status(404).send('Pending request not found in your department.');
    console.error('Unable to return request for correction:', err);
    return res.status(500).send('Unable to return the request for correction.');
  }
  try {
    await notifyUser(borrowerId, 'request_correction', `Please update your request: ${reason}`, requestId);
  } catch (err) {
    console.error('Unable to notify borrower about required corrections:', err);
    return res.status(500).send('Request was returned for correction, but its notification could not be saved.');
  }
  logAudit(req, 'request.returned_for_correction', 'request', requestId, { reason }, (auditError) => {
    if (auditError) {
      console.error('Unable to record request correction:', auditError);
      return res.status(500).send('Request was returned for correction, but its audit record could not be saved.');
    }
    res.redirect('/requests');
  });
});

router.post('/resubmit/:id', isAuthenticated, authorizeRoles('student', 'faculty'), async (req, res) => {
  const requestId = Number(req.params.id);
  const quantity = Number(req.body.quantity);
  const purpose = typeof req.body.purpose === 'string' ? req.body.purpose.trim() : '';
  const borrowDateTime = parseDateTime(req.body.borrow_datetime);
  const returnDateTime = parseDateTime(req.body.return_datetime);
  if (!Number.isSafeInteger(requestId) || requestId < 1 || !Number.isSafeInteger(quantity) || quantity < 1 ||
      !purpose || purpose.length > 500 || !borrowDateTime || !returnDateTime ||
      req.body.borrow_datetime < getPhtDateTime() || req.body.borrow_datetime > req.body.return_datetime) {
    return res.status(400).send('Enter a valid quantity, purpose, and future borrowing schedule.');
  }
  try {
    await db.transaction(async (connection) => {
      const [requests] = await connection.query(
        `SELECT equipment_id, status FROM borrow_requests
         WHERE id = ? AND user_id = ? AND department_id = ?
         FOR UPDATE`,
        [requestId, req.session.user.id, req.session.user.departmentId]
      );
      const request = requests[0];
      if (!request || request.status.toLowerCase() !== 'returned_for_correction') {
        throw new Error('REQUEST_NOT_CORRECTION');
      }
      const [items] = await connection.query(
        `SELECT total_quantity FROM equipment
         WHERE id = ? AND department_id = ? AND status = 'Available'
         FOR UPDATE`,
        [request.equipment_id, req.session.user.departmentId]
      );
      if (!items.length) throw new Error('EQUIPMENT_UNAVAILABLE');
      const [reservedRows] = await connection.query(
        `SELECT COALESCE(SUM(quantity), 0) AS reserved_qty
         FROM borrow_requests
         WHERE equipment_id = ? AND id <> ?
           AND LOWER(status) IN ('pending', 'approved', 'borrowed')
           AND (
             (LOWER(status) = 'borrowed'
               AND TIMESTAMP(requested_start_date, requested_start_time) <= ?)
             OR (LOWER(status) IN ('pending', 'approved')
               AND TIMESTAMP(requested_start_date, requested_start_time) <= ?
               AND TIMESTAMP(requested_due_date, requested_due_time) >= ?)
           )`,
        [
          request.equipment_id, requestId,
          `${returnDateTime.date} ${returnDateTime.time}`,
          `${returnDateTime.date} ${returnDateTime.time}`,
          `${borrowDateTime.date} ${borrowDateTime.time}`
        ]
      );
      if (Number(items[0].total_quantity) - Number(reservedRows[0].reserved_qty) < quantity) {
        throw new Error('INSUFFICIENT_SCHEDULE_STOCK');
      }
      await connection.query(
        `UPDATE borrow_requests
         SET quantity = ?, request_note = ?, requested_start_date = ?, requested_start_time = ?,
           requested_due_date = ?, requested_due_time = ?, status = 'pending', decision_note = NULL
         WHERE id = ?`,
        [
          quantity, purpose, borrowDateTime.date, borrowDateTime.time,
          returnDateTime.date, returnDateTime.time, requestId
        ]
      );
    });
  } catch (err) {
    if (err.message === 'REQUEST_NOT_CORRECTION') return res.status(404).send('Request for correction not found.');
    if (err.message === 'EQUIPMENT_UNAVAILABLE' || err.message === 'INSUFFICIENT_SCHEDULE_STOCK') {
      return res.redirect('/requests?notice=availability');
    }
    console.error('Unable to resubmit corrected request:', err);
    return res.status(500).send('Unable to resubmit the corrected request.');
  }
  try {
    await notifyUser(req.session.user.id, 'request_resubmitted', 'Your corrected request was resubmitted for review.', requestId);
  } catch (err) {
    console.error('Unable to notify requester about resubmission:', err);
    return res.status(500).send('Request was resubmitted, but its notification could not be saved.');
  }
  logAudit(req, 'request.resubmitted', 'request', requestId, { quantity }, (auditError) => {
    if (auditError) {
      console.error('Unable to record corrected request:', auditError);
      return res.status(500).send('Request was resubmitted, but its audit record could not be saved.');
    }
    res.redirect('/requests?notice=corrected');
  });
});

router.post('/return/:id', isAuthenticated, authorizeRoles('admin', 'department_admin', 'custodian'), async (req, res) => {
  const requestId = Number(req.params.id);
  const condition = typeof req.body.post_condition === 'string' ? req.body.post_condition.trim() : 'Returned Good';
  if (!Number.isSafeInteger(requestId) || requestId < 1 ||
      !['Returned Good', 'Returned Damaged', 'Returned Lost'].includes(condition)) {
    return res.status(400).send('Select a valid request and return condition.');
  }

  let borrowerId;
  try {
    await db.transaction(async (connection) => {
      const scope = req.session.user.role === 'admin' ? '' : ' AND requests.department_id = ?';
      const params = req.session.user.role === 'admin'
        ? [requestId]
        : [requestId, req.session.user.departmentId];
      const [rows] = await connection.query(
        `SELECT requests.id, requests.user_id, requests.equipment_id, requests.quantity, requests.status,
          equipment.total_quantity AS total_qty
         FROM borrow_requests requests
         JOIN equipment ON equipment.id = requests.equipment_id
         WHERE requests.id = ?${scope} FOR UPDATE`,
        params
      );
      const request = rows[0];
      if (!request || request.status.toLowerCase() !== 'borrowed') throw new Error('REQUEST_NOT_BORROWED');
      borrowerId = request.user_id;

      if (condition === 'Returned Good') {
        await connection.query(
          'UPDATE equipment SET available_qty = available_qty + ? WHERE id = ?',
          [request.quantity, request.equipment_id]
        );
      } else if (condition === 'Returned Damaged') {
        await connection.query(
          "UPDATE equipment SET status = 'Maintenance', `condition` = 'Damaged' WHERE id = ?",
          [request.equipment_id]
        );
      } else {
        if (Number(request.total_qty) < Number(request.quantity)) throw new Error('INVALID_LOST_QUANTITY');
        await connection.query(
          "UPDATE equipment SET total_quantity = total_quantity - ?, `condition` = 'Lost', status = 'Maintenance' WHERE id = ?",
          [request.quantity, request.equipment_id]
        );
      }
      await connection.query(
        "UPDATE borrow_requests SET status = 'returned', post_condition = ?, returned_at = CURRENT_TIMESTAMP WHERE id = ?",
        [condition, requestId]
      );
    });
  } catch (err) {
    if (err.message === 'REQUEST_NOT_BORROWED') return res.status(409).send('This request is no longer active.');
    if (err.message === 'INVALID_LOST_QUANTITY') return res.status(409).send('The lost quantity exceeds the recorded asset quantity.');
    console.error('Unable to record equipment return:', err);
    return res.status(500).send('Unable to record equipment return.');
  }

  try {
    await notifyUser(borrowerId, 'request_returned', `The return was recorded with condition: ${condition}.`, requestId);
  } catch (err) {
    console.error('Unable to notify borrower about equipment return:', err);
    return res.status(500).send('Equipment return was recorded, but its notification could not be saved.');
  }
  logAudit(req, 'request.returned', 'request', requestId, { condition }, (auditError) => {
    if (auditError) {
      console.error('Unable to record equipment return:', auditError);
      return res.status(500).send('Equipment was returned, but its audit record could not be saved.');
    }
    res.redirect('/requests');
  });
});

module.exports = router;
