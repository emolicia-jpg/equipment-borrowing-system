const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../config/database');
const logAudit = require('../utils/audit');

const router = express.Router();
const CSPC_EMAIL_PATTERN = /^[^\s@]+@my\.cspc\.edu\.ph$/i;

router.get('/login', (req, res) => {
  res.render('login', { error: null });
});

router.post('/login', (req, res) => {
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';

  if (!CSPC_EMAIL_PATTERN.test(email)) {
    return res.status(400).render('login', {
      error: 'Use your CSPC email address ending in @my.cspc.edu.ph.'
    });
  }

  db.get(
    `SELECT users.id, users.full_name AS name, users.email, users.password_hash AS password, users.role,
      users.department_id, departments.name AS department_name
     FROM users
     JOIN departments ON departments.id = users.department_id
     WHERE users.email = ?`,
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
        role: user.role,
        departmentId: user.department_id,
        departmentName: user.department_name
      };
      res.redirect('/dashboard');
    }
  );
});

router.get('/register', (req, res) => {
  db.all('SELECT id, code, name FROM departments ORDER BY name', [], (err, departments) => {
    if (err) {
      console.error('Unable to load departments for registration:', err);
      return res.status(500).send('Unable to load registration information.');
    }
    res.render('register', { error: null, departments });
  });
});

router.post('/register', (req, res) => {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const departmentId = Number(req.body.department_id);

  if (!name || name.length > 100 || !CSPC_EMAIL_PATTERN.test(email) || password.length < 8 ||
      !Number.isSafeInteger(departmentId) || departmentId < 1) {
    return db.all('SELECT id, code, name FROM departments ORDER BY name', [], (departmentError, departments) => {
      if (departmentError) {
        console.error('Unable to reload departments for registration:', departmentError);
        return res.status(500).send('Unable to load registration information.');
      }
      res.status(400).render('register', {
        error: 'Enter your name, use a CSPC email ending in @my.cspc.edu.ph, choose a department, and choose a password of at least 8 characters.',
        departments
      });
    });
  }

  db.get('SELECT id, name FROM departments WHERE id = ?', [departmentId], (departmentError, department) => {
    if (departmentError) {
      console.error('Unable to check registration department:', departmentError);
      return res.status(500).send('Unable to register right now.');
    }
    if (!department) {
      return res.status(400).send('Choose a valid department.');
    }

    db.get('SELECT id FROM users WHERE email = ?', [email], async (lookupError, existingUser) => {
      if (lookupError) {
        console.error('Unable to check registration email:', lookupError);
        return res.status(500).send('Unable to register right now.');
      }

      if (existingUser) {
        return db.all('SELECT id, code, name FROM departments ORDER BY name', [], (err, departments) => {
          if (err) {
            console.error('Unable to reload departments for registration:', err);
            return res.status(500).send('Unable to register right now.');
          }
          res.status(409).render('register', { error: 'An account with that email already exists.', departments });
        });
      }

      let hashedPassword;
      try {
        hashedPassword = await bcrypt.hash(password, 10);
      } catch (hashError) {
        console.error('Unable to secure registration password:', hashError);
        return res.status(500).send('Unable to register right now.');
      }

      db.run(
        "INSERT INTO users (full_name, email, password_hash, role, department_id) VALUES (?, ?, ?, 'student', ?)",
        [name, email, hashedPassword, departmentId],
        function (insertError) {
          if (insertError) {
            console.error('Unable to create user account:', insertError);
            return res.status(500).send('Unable to register right now.');
          }

          req.session.user = {
            id: this.lastID,
            name,
            email,
            role: 'student',
            departmentId,
            departmentName: department.name
          };
          logAudit(req, 'user.registered', 'user', this.lastID, { departmentId }, (auditError) => {
            if (auditError) {
              console.error('Unable to record account registration:', auditError);
              return res.status(500).send('Your account was created, but its audit record could not be saved. Contact the system administrator.');
            }
            res.redirect('/dashboard');
          });
        }
      );
    });
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
