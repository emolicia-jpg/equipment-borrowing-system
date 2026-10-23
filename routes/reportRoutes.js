const express = require('express');
const db = require('../config/database');
const { isAuthenticated, authorizeRoles } = require('../middleware/auth');

const router = express.Router();
const REPORT_ROLES = ['admin', 'department_admin', 'dean'];

function csvCell(value) {
  const text = value == null ? '' : String(value);
  const safeText = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replace(/"/g, '""')}"`;
}

async function loadReport(user) {
  const equipmentScope = user.role === 'admin' ? '' : ' AND equipment.department_id = ?';
  const requestScope = user.role === 'admin' ? '' : ' AND requests.department_id = ?';
  const params = user.role === 'admin' ? [] : [user.departmentId];

  const [equipment] = await db.query(
    `SELECT departments.code AS department_code, equipment.name,
      equipment.category, equipment.total_quantity AS total_qty, equipment.available_qty,
      equipment.\`condition\`, equipment.status
     FROM equipment
     JOIN departments ON departments.id = equipment.department_id
     WHERE (equipment.status = 'Maintenance' OR equipment.\`condition\` IN ('Damaged', 'Lost'))
     ${equipmentScope}
     ORDER BY departments.code, equipment.name`,
    params
  );
  const [requests] = await db.query(
    `SELECT departments.code AS department_code, equipment.name AS equipment_name,
      users.full_name AS borrower_name, requests.quantity, requests.status,
      DATE_FORMAT(TIMESTAMP(requests.requested_start_date, requests.requested_start_time), '%b %e, %Y %h:%i %p') AS borrow_schedule,
      DATE_FORMAT(TIMESTAMP(requests.requested_due_date, requests.requested_due_time), '%b %e, %Y %h:%i %p') AS due_schedule,
      DATE_FORMAT(requests.borrowed_at, '%b %e, %Y %h:%i %p') AS released_at,
      DATE_FORMAT(requests.returned_at, '%b %e, %Y %h:%i %p') AS returned_at,
      (LOWER(requests.status) = 'borrowed'
        AND TIMESTAMP(requests.requested_due_date, requests.requested_due_time) < CURRENT_TIMESTAMP) AS is_overdue,
      requests.pre_condition, requests.post_condition, requests.decision_note
     FROM borrow_requests requests
     JOIN departments ON departments.id = requests.department_id
     JOIN equipment ON equipment.id = requests.equipment_id
     JOIN users ON users.id = requests.user_id
     WHERE 1 = 1${requestScope}
     ORDER BY requests.requested_start_date DESC, requests.id DESC`,
    params
  );
  const [utilization] = await db.query(
    `SELECT departments.code AS department_code, equipment.name AS equipment_name,
      equipment.total_quantity AS total_qty,
      COUNT(requests.id) AS request_count,
      COALESCE(SUM(requests.quantity), 0) AS units_requested
     FROM equipment
     JOIN departments ON departments.id = equipment.department_id
     LEFT JOIN borrow_requests requests ON requests.equipment_id = equipment.id
     WHERE 1 = 1${equipmentScope}
     GROUP BY departments.code, equipment.id, equipment.name, equipment.total_quantity
     ORDER BY departments.code, equipment.name`,
    params
  );
  return { equipment, requests, utilization };
}

function toReportRows({ equipment, requests, utilization }) {
  return [
    ['Record type', 'Department', 'Item', 'Borrower', 'Quantity', 'Status / condition', 'Borrow schedule', 'Due schedule', 'Released at', 'Returned at'],
    ...equipment.map((item) => [
      'Asset condition',
      item.department_code,
      item.name,
      '',
      item.total_qty,
      item.condition === 'Good' ? item.status : item.condition,
      '', '', '', ''
    ]),
    ...utilization.map((item) => [
      'Utilization',
      item.department_code,
      item.equipment_name,
      '',
      `${item.units_requested} units`,
      `${item.request_count} requests / ${item.total_qty} total units`,
      '',
      '',
      '',
      ''
    ]),
    ...requests.map((item) => [
      String(item.status).toLowerCase() === 'borrowed'
        ? item.is_overdue ? 'Overdue borrowing' : 'Current loan'
        : String(item.status).toLowerCase() === 'returned' ? 'Borrowing history' : 'Request history',
      item.department_code,
      item.equipment_name,
      item.borrower_name,
      item.quantity,
      [item.pre_condition, item.post_condition, item.decision_note].filter(Boolean).join(' | ') || item.status,
      item.borrow_schedule,
      item.due_schedule,
      item.released_at,
      item.returned_at
    ])
  ];
}

router.get('/reports', isAuthenticated, authorizeRoles(...REPORT_ROLES), async (req, res) => {
  try {
    const rows = toReportRows(await loadReport(req.session.user));
    res.render('report', {
      user: req.session.user,
      columns: rows[0],
      records: rows.slice(1)
    });
  } catch (err) {
    console.error('Unable to load equipment report preview:', err);
    res.status(500).send('Unable to load the equipment report preview.');
  }
});

router.get('/reports.csv', isAuthenticated, authorizeRoles(...REPORT_ROLES), async (req, res) => {
  try {
    const rows = toReportRows(await loadReport(req.session.user));
    res.type('text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="equipment-asset-report.csv"');
    res.send(rows.map((row) => row.map(csvCell).join(',')).join('\r\n'));
  } catch (err) {
    console.error('Unable to export equipment report:', err);
    res.status(500).send('Unable to export the equipment report.');
  }
});

module.exports = router;
