require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');

const authRoutes = require('./routes/authRoutes');
const equipmentRoutes = require('./routes/equipmentRoutes');
const requestRoutes = require('./routes/requestRoutes');

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

// Route Middlewares
app.use('/auth', authRoutes);
app.use('/equipment', equipmentRoutes);
app.use('/requests', requestRoutes);

// Main Dashboard
app.get('/dashboard', (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');
  res.render('dashboard', { user: req.session.user, error: null });
});

app.get('/', (req, res) => {
  res.redirect('/auth/login');
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
