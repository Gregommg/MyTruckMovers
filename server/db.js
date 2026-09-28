const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Configurable so a deployment can point both at a mounted persistent volume
// (e.g. DB_PATH=/data/trackmovers.db) without any code changes.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'trackmovers.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Defensive migration for databases created by an earlier version of this schema
// (CREATE TABLE IF NOT EXISTS above won't add columns to a table that already exists).
function addColumn(table, def) {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${def}`); } catch { /* already there */ }
}

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','driver')),
  reset_code_hash TEXT,
  reset_expires INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS drivers (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  truck_reg TEXT NOT NULL,
  truck_type TEXT NOT NULL,
  id_pdf TEXT NOT NULL,
  passport_pdf TEXT NOT NULL,
  truck_photo TEXT NOT NULL,
  verified INTEGER DEFAULT 1,
  availability TEXT DEFAULT 'offline',   -- offline | empty | dropping_off | busy
  lat REAL, lng REAL, loc_at TEXT
);

CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  driver_id INTEGER REFERENCES users(id),
  truck_type TEXT NOT NULL,
  item TEXT,
  pickup_lat REAL, pickup_lng REAL, pickup_addr TEXT,
  dest_lat REAL, dest_lng REAL, dest_addr TEXT,
  distance_km REAL,
  price INTEGER,
  status TEXT DEFAULT 'pending',          -- pending | accepted | picked_up | completed | cancelled | expired
  retries INTEGER DEFAULT 0,
  expires_at INTEGER,
  payment_status TEXT DEFAULT 'unpaid',   -- unpaid | pending | paid | failed
  payment_method TEXT,                    -- e.g. mpesa
  mpesa_receipt TEXT,
  mpesa_checkout_id TEXT,
  mpesa_merchant_id TEXT,
  mpesa_phone TEXT,
  paid_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- A far-away driver applies for a job; the customer must accept the application
CREATE TABLE IF NOT EXISTS offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES requests(id),
  driver_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT DEFAULT 'pending',          -- pending | accepted | rejected
  UNIQUE (request_id, driver_id)
);
`);

addColumn('users', 'reset_code_hash TEXT');
addColumn('users', 'reset_expires INTEGER');
addColumn('requests', "payment_status TEXT DEFAULT 'unpaid'");
addColumn('requests', 'payment_method TEXT');
addColumn('requests', 'mpesa_receipt TEXT');
addColumn('requests', 'mpesa_checkout_id TEXT');
addColumn('requests', 'mpesa_merchant_id TEXT');
addColumn('requests', 'mpesa_phone TEXT');
addColumn('requests', 'paid_at TEXT');

module.exports = db;
