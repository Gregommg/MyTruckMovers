const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/mytruckmovers',
  connectionTimeoutMillis: 10000,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

function prepare(client, sql) {
  const ignored = /^\s*INSERT OR IGNORE INTO/i.test(sql);
  let index = 0;
  let statement = sql
    .replace(/^\s*INSERT OR IGNORE INTO/i, 'INSERT INTO')
    .replace(/datetime\('now'\)/gi, 'CURRENT_TIMESTAMP')
    .replace(/\?/g, () => `$${++index}`);
  if (ignored) statement += ' ON CONFLICT DO NOTHING';

  return {
    async get(...params) {
      const result = await client.query(statement, params);
      return result.rows[0];
    },
    async all(...params) {
      const result = await client.query(statement, params);
      return result.rows;
    },
    async run(...params) {
      const insert = /^\s*INSERT\b/i.test(statement);
      const result = await client.query(insert ? `${statement} RETURNING id` : statement, params);
      return { changes: result.rowCount, lastInsertRowid: result.rows[0]?.id };
    },
  };
}

const db = {
  prepare(sql) {
    return prepare(pool, sql);
  },
  async transaction(callback) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback({ prepare: (sql) => prepare(client, sql) });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },
  async init() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        phone TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user','driver')),
        reset_code_hash TEXT,
        reset_expires BIGINT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS drivers (
        user_id INTEGER PRIMARY KEY REFERENCES users(id),
        truck_reg TEXT NOT NULL,
        truck_type TEXT NOT NULL,
        id_pdf TEXT NOT NULL,
        passport_pdf TEXT NOT NULL,
        truck_photo TEXT NOT NULL,
        verified INTEGER DEFAULT 1,
        availability TEXT DEFAULT 'offline',
        lat DOUBLE PRECISION,
        lng DOUBLE PRECISION,
        loc_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS requests (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        driver_id INTEGER REFERENCES users(id),
        truck_type TEXT NOT NULL,
        item TEXT,
        pickup_lat DOUBLE PRECISION,
        pickup_lng DOUBLE PRECISION,
        pickup_addr TEXT,
        dest_lat DOUBLE PRECISION,
        dest_lng DOUBLE PRECISION,
        dest_addr TEXT,
        distance_km DOUBLE PRECISION,
        price INTEGER,
        status TEXT DEFAULT 'pending',
        retries INTEGER DEFAULT 0,
        expires_at BIGINT,
        payment_status TEXT DEFAULT 'unpaid',
        payment_method TEXT,
        mpesa_receipt TEXT,
        mpesa_checkout_id TEXT,
        mpesa_merchant_id TEXT,
        mpesa_phone TEXT,
        paid_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS offers (
        id SERIAL PRIMARY KEY,
        request_id INTEGER NOT NULL REFERENCES requests(id),
        driver_id INTEGER NOT NULL REFERENCES users(id),
        status TEXT DEFAULT 'pending',
        UNIQUE (request_id, driver_id)
      );

      ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_code_hash TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_expires BIGINT;
      ALTER TABLE requests ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'unpaid';
      ALTER TABLE requests ADD COLUMN IF NOT EXISTS payment_method TEXT;
      ALTER TABLE requests ADD COLUMN IF NOT EXISTS mpesa_receipt TEXT;
      ALTER TABLE requests ADD COLUMN IF NOT EXISTS mpesa_checkout_id TEXT;
      ALTER TABLE requests ADD COLUMN IF NOT EXISTS mpesa_merchant_id TEXT;
      ALTER TABLE requests ADD COLUMN IF NOT EXISTS mpesa_phone TEXT;
      ALTER TABLE requests ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
    `);
  },
};

module.exports = db;