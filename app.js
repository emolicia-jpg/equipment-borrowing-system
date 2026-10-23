require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');

const authRoutes = require('./routes/authRoutes');
const equipmentRoutes = require('./routes/equipmentRoutes');
const requestRoutes = require('./routes/requestRoutes');
const adminRoutes = require('./routes/adminRoutes');
const reportRoutes = require('./routes/reportRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const db = require('./config/database');
const { createDueReminders } = require('./utils/notifications');

const app = express();

// Body Parser
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Static Files
app.use(express.static(path.join(__dirname, 'public')));

// View Engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Session Config
app.use(session({
  secret: process.env.SESSION_SECRET || 'default_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 3600000 } // 1 hour
}));

app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  res.locals.user = req.session ? req.session.user : null;
  next();
});

// Route Middlewares
app.use('/auth', authRoutes);
app.use('/equipment', equipmentRoutes);
app.use('/requests', requestRoutes);
app.use('/admin', adminRoutes);
app.use(notificationRoutes);
app.use(reportRoutes);

// Main Dashboard
app.get('/dashboard', async (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');

  if (req.session.user.role === 'dean' || req.session.user.role === 'department_admin') {
    try {
      const departmentId = req.session.user.departmentId;
      const [[assets]] = await db.query(
        `SELECT COALESCE(SUM(total_quantity), 0) AS total_assets,
          COALESCE(SUM(CASE WHEN status = 'Maintenance' THEN 1 ELSE 0 END), 0) AS maintenance_count
         FROM equipment WHERE department_id = ?`,
        [departmentId]
      );
      const [[activity]] = await db.query(
        `SELECT COALESCE(SUM(CASE WHEN LOWER(status) = 'borrowed' THEN quantity ELSE 0 END), 0) AS currently_borrowed,
          COALESCE(SUM(CASE WHEN LOWER(status) = 'borrowed'
            AND TIMESTAMP(requested_due_date, requested_due_time) < CURRENT_TIMESTAMP THEN 1 ELSE 0 END), 0) AS overdue_count
         FROM borrow_requests WHERE department_id = ?`,
        [departmentId]
      );
      const [popularEquipment] = await db.query(
        `SELECT equipment.name, SUM(requests.quantity) AS request_count
         FROM borrow_requests requests JOIN equipment ON equipment.id = requests.equipment_id
         WHERE requests.department_id = ?
         GROUP BY equipment.id, equipment.name
         ORDER BY request_count DESC, equipment.name
         LIMIT 5`,
        [departmentId]
      );
      const [peakPeriods] = await db.query(
        `SELECT DATE_FORMAT(requested_start_date, '%Y-%m') AS period, COUNT(*) AS request_count
         FROM borrow_requests WHERE department_id = ?
         GROUP BY DATE_FORMAT(requested_start_date, '%Y-%m')
         ORDER BY request_count DESC, period DESC
         LIMIT 6`,
        [departmentId]
      );
      return res.render('dashboard', {
        user: req.session.user,
        error: null,
        overdueItems: [],
        deanStats: { ...assets, ...activity },
        popularEquipment,
        peakPeriods
      });
    } catch (err) {
      console.error('Unable to load department dashboard:', err);
      return res.status(500).send('Unable to load department dashboard information.');
    }
  }

  if (req.session.user.role !== 'student') {
    try {
      await createDueReminders(req.session.user.id);
      return res.render('dashboard', {
        user: req.session.user,
        error: null,
        overdueItems: [],
        activeItems: []
      });
    } catch (err) {
      console.error('Unable to create return reminders:', err);
      return res.status(500).send('Unable to load dashboard notifications.');
    }
  }

  try {
    await createDueReminders(req.session.user.id);
    const [activeBorrowings] = await db.query(
    `SELECT requests.id, requests.quantity, equipment.name AS equipment_name,
      DATE_FORMAT(TIMESTAMP(requests.requested_due_date, requests.requested_due_time), '%b %e, %Y %h:%i %p') AS due_date,
      (TIMESTAMP(requests.requested_due_date, requests.requested_due_time) < CURRENT_TIMESTAMP) AS is_overdue
     FROM borrow_requests requests
     JOIN equipment ON requests.equipment_id = equipment.id
     WHERE requests.user_id = ? AND requests.department_id = ? AND LOWER(requests.status) = 'borrowed'
     ORDER BY requests.requested_due_date, requests.requested_due_time`,
      [req.session.user.id, req.session.user.departmentId]
    );
    return res.render('dashboard', {
      user: req.session.user,
      error: null,
      overdueItems: activeBorrowings.filter((item) => Boolean(item.is_overdue)),
      activeItems: activeBorrowings.filter((item) => !item.is_overdue)
    });
  } catch (err) {
    console.error('Unable to load overdue equipment for dashboard:', err);
    return res.status(500).send('Unable to load dashboard information.');
  }
});

app.get('/', (req, res) => {
  res.redirect('/auth/login');
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
