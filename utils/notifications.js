const db = require('../config/database');

async function notifyUser(userId, type, message, requestId = null) {
  await db.query(
    `INSERT INTO notifications (user_id, request_id, notification_type, message)
     VALUES (?, ?, ?, ?)`,
    [userId, requestId, type, message]
  );
}

async function createDueReminders(userId) {
  await db.transaction(async (connection) => {
    const [requests] = await connection.query(
      `SELECT requests.id, requests.requested_due_date, equipment.name AS equipment_name,
        (requests.requested_due_date < CURDATE()) AS is_overdue
       FROM borrow_requests requests
       JOIN equipment ON equipment.id = requests.equipment_id
       WHERE requests.user_id = ?
         AND LOWER(requests.status) = 'borrowed'
         AND requests.requested_due_date <= DATE_ADD(CURDATE(), INTERVAL 1 DAY)
       FOR UPDATE`,
      [userId]
    );
    for (const request of requests) {
      const [existing] = await connection.query(
        `SELECT id FROM notifications
         WHERE user_id = ? AND request_id = ? AND notification_type = 'due_reminder'
         LIMIT 1`,
        [userId, request.id]
      );
      if (existing.length) continue;
      const message = request.is_overdue
        ? `Your return for ${request.equipment_name} is overdue.`
        : `Your return for ${request.equipment_name} is due soon.`;
      await connection.query(
        `INSERT INTO notifications (user_id, request_id, notification_type, message)
         VALUES (?, ?, 'due_reminder', ?)`,
        [userId, request.id, message]
      );
    }
  });
}

module.exports = { notifyUser, createDueReminders };
