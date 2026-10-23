const express = require('express');
const db = require('../config/database');
const { isAuthenticated } = require('../middleware/auth');
const { createDueReminders } = require('../utils/notifications');

const router = express.Router();

router.get('/notifications', isAuthenticated, async (req, res) => {
  try {
    await createDueReminders(req.session.user.id);
    const [notifications] = await db.query(
      `SELECT id, request_id, notification_type, message,
        DATE_FORMAT(created_at, '%b %e, %Y %h:%i %p') AS created_at, read_at
       FROM notifications
       WHERE user_id = ?
       ORDER BY read_at IS NULL DESC, created_at DESC
       LIMIT 100`,
      [req.session.user.id]
    );
    res.render('notifications', {
      user: req.session.user,
      notifications
    });
  } catch (err) {
    console.error('Unable to load user notifications:', err);
    res.status(500).send('Unable to load notifications.');
  }
});

router.post('/notifications/:id/read', isAuthenticated, async (req, res) => {
  const notificationId = Number(req.params.id);
  if (!Number.isSafeInteger(notificationId) || notificationId < 1) {
    return res.status(400).send('Select a valid notification.');
  }
  try {
    const [result] = await db.query(
      'UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND read_at IS NULL',
      [notificationId, req.session.user.id]
    );
    if (!result.affectedRows) {
      const [rows] = await db.query(
        'SELECT id FROM notifications WHERE id = ? AND user_id = ?',
        [notificationId, req.session.user.id]
      );
      if (!rows.length) return res.status(404).send('That notification no longer exists.');
    }
    res.redirect('/notifications');
  } catch (err) {
    console.error('Unable to mark notification as read:', err);
    res.status(500).send('Unable to update the notification.');
  }
});

router.post('/notifications/read-all', isAuthenticated, async (req, res) => {
  try {
    await db.query(
      'UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND read_at IS NULL',
      [req.session.user.id]
    );
    res.redirect('/notifications');
  } catch (err) {
    console.error('Unable to mark notifications as read:', err);
    res.status(500).send('Unable to update notifications.');
  }
});

module.exports = router;
