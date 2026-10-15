const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../config/database');

const router = express.Router();

router.get('/login', (req, res) => {
  res.render('login', { error: null });
});

router.post('/login', (req, res) => {
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';

  db.get(
    'SELECT id, name, email, password, role FROM users WHERE email = ?',
    [email],
    async (err, user) => {
      if (err) {
        console.error('Unable to look up login account:', err);
        return res.status(500).render('login', { error: 'Unable to log in right now.' });
      }

      if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).render('login', { error: 'Invalid email or password.' });
      }

      req.session.user = {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      };
      res.redirect('/dashboard');
    }
  );
});

router.get('/register', (req, res) => {
  res.render('register', { error: null });
});

router.post('/register', (req, res) => {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';

  if (!name || !email || password.length < 8) {
    return res.status(400).render('register', {
      error: 'Enter your name and email, and use a password of at least 8 characters.'
    });
  }

  db.get('SELECT id FROM users WHERE email = ?', [email], async (lookupError, existingUser) => {
    if (lookupError) {
      console.error('Unable to check registration email:', lookupError);
      return res.status(500).render('register', { error: 'Unable to register right now.' });
    }

    if (existingUser) {
      return res.status(409).render('register', { error: 'An account with that email already exists.' });
    }

    let hashedPassword;
    try {
      hashedPassword = await bcrypt.hash(password, 10);
    } catch (hashError) {
      console.error('Unable to secure registration password:', hashError);
      return res.status(500).render('register', { error: 'Unable to register right now.' });
    }

    db.run(
      "INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, 'student')",
      [name, email, hashedPassword],
      function (insertError) {
        if (insertError) {
          console.error('Unable to create user account:', insertError);
          return res.status(500).render('register', { error: 'Unable to register right now.' });
        }

        req.session.user = {
          id: this.lastID,
          name,
          email,
          role: 'student'
        };
        res.redirect('/dashboard');
      }
    );
  });
});

router.get('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) {
      return next(err);
    }
    res.redirect('/auth/login');
  });
});

module.exports = router;
