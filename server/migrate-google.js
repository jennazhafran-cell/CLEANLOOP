// Import db.js supaya semua tabel (CREATE TABLE IF NOT EXISTS) dijalankan lebih dulu.
import { db } from './db.js';

const cols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);

if (!cols.includes('google_id')) {
  db.exec('ALTER TABLE users ADD COLUMN google_id TEXT');
  console.log('+ google_id ditambahkan');
} else {
  console.log('= google_id sudah ada');
}

if (!cols.includes('picture')) {
  db.exec('ALTER TABLE users ADD COLUMN picture TEXT');
  console.log('+ picture ditambahkan');
} else {
  console.log('= picture sudah ada');
}

console.log('Migrasi selesai.');