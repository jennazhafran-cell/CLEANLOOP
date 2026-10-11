import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const raw = new DatabaseSync(path.join(__dirname, '..', 'data.db'));
raw.exec('PRAGMA journal_mode = WAL;');
raw.exec('PRAGMA foreign_keys = ON;');

// Adaptor kecil supaya API-nya sama seperti better-sqlite3.
export const db = {
  exec: sql => raw.exec(sql),
  pragma: sql => raw.exec(sql),
  prepare: sql => raw.prepare(sql),
  transaction: fn => (...args) => {
    raw.exec('BEGIN');
    try {
      const r = fn(...args);
      raw.exec('COMMIT');
      return r;
    } catch (e) {
      raw.exec('ROLLBACK');
      throw e;
    }
  }
};

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','staff','admin')),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS addresses (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  text TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  service_id TEXT NOT NULL,
  service_name TEXT NOT NULL,
  price_per_kg INTEGER NOT NULL,
  weight REAL NOT NULL,
  subtotal INTEGER NOT NULL,
  ship INTEGER NOT NULL,
  discount INTEGER NOT NULL DEFAULT 0,
  promo_code TEXT,
  total INTEGER NOT NULL,
  status TEXT NOT NULL,
  mode TEXT NOT NULL,
  scheduled_date TEXT NOT NULL,
  scheduled_slot TEXT NOT NULL,
  telp TEXT NOT NULL,
  alamat TEXT NOT NULL,
  note TEXT,
  assigned_staff_id INTEGER REFERENCES users(id),
  pay_status TEXT NOT NULL,
  payment_method TEXT,
  payment_ref TEXT,
  payment_fee INTEGER NOT NULL DEFAULT 0,
  grand_total INTEGER,
  paid_at INTEGER,
  created_at INTEGER NOT NULL,
  cancelled_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_staff ON orders(assigned_staff_id);
CREATE INDEX IF NOT EXISTS idx_orders_slot ON orders(scheduled_date, scheduled_slot, mode, status);

CREATE TABLE IF NOT EXISTS reviews (
  order_id INTEGER PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  text TEXT,
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS promos (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('pct','flat')),
  value INTEGER NOT NULL,
  max_amount INTEGER,
  min_subtotal INTEGER,
  first_only INTEGER NOT NULL DEFAULT 0,
  once_per_user INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
`);

db.prepare(`INSERT OR IGNORE INTO promos
  (code,label,kind,value,max_amount,min_subtotal,first_only,once_per_user)
  VALUES ('PERTAMA10','Diskon 10% pesanan pertama','pct',10,25000,NULL,1,0)`).run();

db.prepare(`INSERT OR IGNORE INTO promos
  (code,label,kind,value,max_amount,min_subtotal,first_only,once_per_user)
  VALUES ('BERSIH5K','Potongan Rp 5.000 (min. Rp 40.000)','flat',5000,NULL,40000,0,1)`).run();