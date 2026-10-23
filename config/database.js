const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
require('dotenv').config();

// The database and tables are created in phpMyAdmin (schema.sql or the migration script).
// This file only connects to it and creates one demo account per stakeholder role.
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '', // XAMPP default: empty
  database: process.env.DB_NAME || 'equipment_borrowing_system',
  waitForConnections: true,
  connectionLimit: 10
});

// One demo account per stakeholder (change/remove these before real use)
const DEMO_USERS = [
  ['Janelle Dela Cruz',        'janelle@my.cspc.edu.ph',     'student123',     'student'],
  ['Demo Instructor',          'instructor@my.cspc.edu.ph',  'instructor123',  'faculty'],
  ['Equipment Custodian',      'custodian@my.cspc.edu.ph',   'custodian123',   'custodian'],
  ['Program Coordinator',      'coordinator@my.cspc.edu.ph', 'coordinator123', 'coordinator'],
  ['Property Office',          'property@my.cspc.edu.ph',    'property123',    'property'],
  ['College Dean',             'dean@my.cspc.edu.ph',        'dean123',        'dean'],
  ['System Admin',             'admin@my.cspc.edu.ph',       'admin123',       'admin'],
  ['Campus Security',          'security@my.cspc.edu.ph',    'security123',    'security']
];

async function ensureUser(name, email, plainPassword, role, departmentId) {
  if (!/^[^\s@]+@my\.cspc\.edu\.ph$/i.test(email.trim())) {
    console.warn(`Skipping demo ${role} account without a valid CSPC email address.`);
    return;
  }
  email = email.trim().toLowerCase();
  const [rows] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
  if (rows.length) return;
  const hash = await bcrypt.hash(plainPassword, 10);
  await pool.query(
    'INSERT INTO users (full_name, email, password_hash, role, department_id) VALUES (?, ?, ?, ?, ?)',
    [name, email, hash, role, departmentId]
  );
}

const ready = (async () => {
  await pool.query('SELECT 1'); // test connection
  const [departments] = await pool.query('SELECT id FROM departments WHERE code = ?', ['CCS']);
  if (!departments.length) {
    throw new Error('The CCS department is missing. Run schema.sql or the required migrations in phpMyAdmin.');
  }
  for (const [name, email, pass, role] of DEMO_USERS) {
    await ensureUser(name, email, pass, role, departments[0].id);
  }
  console.log('MySQL connected and demo accounts are ready.');
})().catch((err) => {
  console.error(
    'Unable to initialize MySQL. Check that MySQL is running, DB_NAME matches your phpMyAdmin database, and the required schema migration has been applied.',
    err
  );
});

/* sqlite3-style wrapper so existing routes using
   db.get / db.all / db.run(sql, params, callback) keep working.
   In db.run callbacks, `this.lastID` and `this.changes` are available. */
function normalize(params, callback) {
  if (typeof params === 'function') return [[], params];
  return [params || [], callback];
}

const db = {
  ready,

  get(sql, params, callback) {
    [params, callback] = normalize(params, callback);
    ready
      .then(() => pool.query(sql, params))
      .then(([rows]) => callback && callback(null, rows[0]))
      .catch((err) => callback && callback(err));
  },

  all(sql, params, callback) {
    [params, callback] = normalize(params, callback);
    ready
      .then(() => pool.query(sql, params))
      .then(([rows]) => callback && callback(null, rows))
      .catch((err) => callback && callback(err));
  },

  run(sql, params, callback) {
    [params, callback] = normalize(params, callback);
    ready
      .then(() => pool.query(sql, params))
      .then(([result]) => {
        if (callback) {
          callback.call({ lastID: result.insertId, changes: result.affectedRows }, null);
        }
      })
      .catch((err) => callback && callback.call({}, err));
  },

  // Promise style for new code: const [rows] = await db.query(sql, params)
  async query(sql, params) {
    await ready;
    return pool.query(sql, params);
  },

  async transaction(work) {
    await ready;
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work(connection);
      await connection.commit();
      return result;
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }
};

module.exports = db;