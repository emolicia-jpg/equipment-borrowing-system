const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const path = require('path');

const dbPath = path.resolve(__dirname, '../database.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  // Users table
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('student', 'faculty', 'custodian', 'admin'))
    )
  `);

  // Equipment table
  db.run(`
    CREATE TABLE IF NOT EXISTS equipment (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      total_qty INTEGER NOT NULL,
      available_qty INTEGER NOT NULL,
      condition TEXT DEFAULT 'Good'
    )
  `);

  // Borrowing Requests table
  db.run(`
    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      equipment_id INTEGER NOT NULL,
      purpose TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      borrow_date TEXT NOT NULL,
      return_date TEXT NOT NULL,
      status TEXT DEFAULT 'Pending' CHECK(status IN ('Pending', 'Approved', 'Borrowed', 'Returned', 'Denied')),
      pre_condition TEXT,
      post_condition TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(equipment_id) REFERENCES equipment(id)
    )
  `);

  // Seed default admin and sample equipment if empty
  db.get("SELECT COUNT(*) AS count FROM users", async (err, row) => {
    if (err) {
      console.error('Unable to check whether the database needs seeding:', err);
      return;
    }

    if (row && row.count === 0) {
      try {
        const [hashedPassword, studentPass, custodianPass] = await Promise.all([
          bcrypt.hash('admin123', 10),
          bcrypt.hash('student123', 10),
          bcrypt.hash('custodian123', 10)
        ]);

        db.run(
          "INSERT INTO users (name, email, password, role) VALUES ('System Admin', 'admin@cspc.edu.ph', ?, 'admin')",
          [hashedPassword],
          reportSeedError
        );
        db.run(
          "INSERT INTO users (name, email, password, role) VALUES ('Janelle Dela Cruz', 'janelle@cspc.edu.ph', ?, 'student')",
          [studentPass],
          reportSeedError
        );
        db.run(
          "INSERT INTO users (name, email, password, role) VALUES ('Equipment Custodian', 'custodian@cspc.edu.ph', ?, 'custodian')",
          [custodianPass],
          reportSeedError
        );

        db.run("INSERT INTO equipment (name, category, total_qty, available_qty, condition) VALUES ('LCD Projector', 'Electronics', 5, 5, 'Good')", reportSeedError);
        db.run("INSERT INTO equipment (name, category, total_qty, available_qty, condition) VALUES ('Arduino Uno Kit', 'Microcontrollers', 15, 15, 'Good')", reportSeedError);
        db.run("INSERT INTO equipment (name, category, total_qty, available_qty, condition) VALUES ('HDMI Cable 10m', 'Accessories', 10, 10, 'Good')", reportSeedError);

        console.log('Database seeded with initial user accounts and equipment items.');
      } catch (seedError) {
        console.error('Unable to seed the database:', seedError);
      }
    }
  });
});

function reportSeedError(err) {
  if (err) {
    console.error('Unable to seed the database:', err);
  }
}

module.exports = db;