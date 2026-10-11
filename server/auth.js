import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { db } from './db.js';

export const COOKIE = 'cl_sid';
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

export const hashPassword  = p => bcrypt.hash(p, 12);
export const verifyPassword = (u, p) => bcrypt.compare(p, u.password_hash);

export function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (id,user_id,expires_at) VALUES (?,?,?)')
    .run(token, userId, Date.now() + SESSION_MS);
  res.cookie(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_MS,
    path: '/'
  });
}

export function destroySession(req, res) {
  const t = req.cookies?.[COOKIE];
  if (t) db.prepare('DELETE FROM sessions WHERE id=?').run(t);
  res.clearCookie(COOKIE, { path: '/' });
}

export function requireAuth(req, res, next) {
  const t = req.cookies?.[COOKIE];
  if (!t) return res.status(401).json({ error: 'unauthorized' });
  const row = db.prepare(`SELECT s.expires_at, u.id, u.name, u.email, u.role
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`).get(t);
  if (!row || row.expires_at < Date.now()) return res.status(401).json({ error: 'unauthorized' });
  req.user = row;
  next();
}

export const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user?.role) ? next() : res.status(403).json({ error: 'forbidden' });