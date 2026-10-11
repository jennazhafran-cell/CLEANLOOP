import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import bcrypt from 'bcryptjs';
import { db } from './db.js';

const name  = process.env.ADMIN_NAME;
const email = process.env.ADMIN_EMAIL;
const pass  = process.env.ADMIN_PASSWORD;

if (!name || !email || !pass) {
  console.error('Set ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD di .env dulu.');
  process.exit(1);
}
if (pass.length < 8) {
  console.error('ADMIN_PASSWORD minimal 8 karakter.');
  process.exit(1);
}

const hash = bcrypt.hashSync(pass, 12);
const cleanEmail = email.trim().toLowerCase();
const existing = db.prepare('SELECT id FROM users WHERE email=?').get(cleanEmail);

if (existing) {
  db.prepare('UPDATE users SET role=?, password_hash=?, name=? WHERE id=?')
    .run('admin', hash, name, existing.id);
  console.log('Admin diperbarui:', cleanEmail);
} else {
  db.prepare('INSERT INTO users (name,email,password_hash,role,created_at) VALUES (?,?,?,?,?)')
    .run(name, cleanEmail, hash, 'admin', Date.now());
  console.log('Admin dibuat:', cleanEmail);
}