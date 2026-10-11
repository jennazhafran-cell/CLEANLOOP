import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import crypto from 'node:crypto';
import { z } from 'zod';
import { OAuth2Client } from 'google-auth-library';
import { db } from './db.js';
import { SERVICES, SLOTS, STATUS, CANCELLED, WA_NUMBER, METHODS } from './catalog.js';
import {
  requireAuth, requireRole, hashPassword, verifyPassword, createSession, destroySession
} from './auth.js';
import { computePricing, assertSlotAvailable, validatePromo, feeOf, HttpError } from './pricing.js';

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));

// Webhook butuh body MENTAH — daftarkan sebelum express.json().
app.post('/api/webhooks/midtrans', express.raw({ type: '*/*' }), midtransWebhook);

app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public')));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 30,
  standardHeaders: true, legacyHeaders: false
});

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const isEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
const newCode = () => 'CL-' + crypto.randomBytes(4).toString('hex').toUpperCase();
const normPhone = v => { const d = String(v).replace(/\D/g, ''); return d.startsWith('62') ? '0' + d.slice(2) : d; };

// Simulasi pembayaran HANYA di non-production.
const SIMULATED = process.env.NODE_ENV !== 'production'
              && process.env.ALLOW_SIMULATED_PAYMENT === 'true';

/* =========================================================
   GOOGLE OAUTH
   ========================================================= */
const googleClient = process.env.GOOGLE_CLIENT_ID
  ? new OAuth2Client(process.env.GOOGLE_CLIENT_ID)
  : null;

/* =========================================================
   AUTH
   ========================================================= */
app.post('/api/auth/register', loginLimiter, wrap(async (req, res) => {
  const { name, email, password } = req.body || {};
  if (typeof name !== 'string' || name.trim().length < 2)
    return res.status(400).json({ error: 'Nama minimal 2 karakter.' });
  if (!isEmail(String(email || ''))) return res.status(400).json({ error: 'Email tidak valid.' });
  if (typeof password !== 'string' || password.length < 8)
    return res.status(400).json({ error: 'Kata sandi minimal 8 karakter.' });

  const cleanEmail = email.trim().toLowerCase();
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(cleanEmail))
    return res.status(409).json({ error: 'Email sudah terdaftar.' });

  const hash = await hashPassword(password);
  const info = db.prepare('INSERT INTO users (name,email,password_hash,role,created_at) VALUES (?,?,?,?,?)')
    .run(name.trim(), cleanEmail, hash, 'customer', Date.now());
  createSession(res, info.lastInsertRowid);
  res.json({ id: info.lastInsertRowid, name: name.trim(), email: cleanEmail, role: 'customer' });
}));

app.post('/api/auth/login', loginLimiter, wrap(async (req, res) => {
  const { email, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE email=?')
    .get(String(email || '').trim().toLowerCase());
  if (!u || !u.password_hash || !(await verifyPassword(u, String(password || ''))))
    return res.status(401).json({ error: 'Email atau kata sandi salah.' });
  createSession(res, u.id);
  res.json({ id: u.id, name: u.name, email: u.email, role: u.role, picture: u.picture || null });
}));

app.post('/api/auth/google', loginLimiter, wrap(async (req, res) => {
  if (!googleClient)
    return res.status(503).json({ error: 'Google Sign-In belum dikonfigurasi.' });

  const { credential } = req.body || {};
  if (typeof credential !== 'string' || !credential)
    return res.status(400).json({ error: 'Token Google tidak ditemukan.' });

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID
    });
    payload = ticket.getPayload();
  } catch {
    return res.status(401).json({ error: 'Token Google tidak valid.' });
  }

  const { sub: googleId, email, name, picture, email_verified } = payload;
  if (!email || !email_verified)
    return res.status(400).json({ error: 'Email Google belum diverifikasi.' });

  const cleanEmail = email.toLowerCase();

  // 1) Cari user berdasarkan google_id
  let user = db.prepare('SELECT * FROM users WHERE google_id=?').get(googleId);

  if (!user) {
    // 2) Kalau belum, cek email — mungkin akun lama (email/password)
    const byEmail = db.prepare('SELECT * FROM users WHERE email=?').get(cleanEmail);
    if (byEmail) {
      db.prepare('UPDATE users SET google_id=?, picture=? WHERE id=?')
        .run(googleId, picture || null, byEmail.id);
      user = db.prepare('SELECT * FROM users WHERE id=?').get(byEmail.id);
    } else {
      // 3) Belum ada sama sekali — buat user baru
      const info = db.prepare(`INSERT INTO users
        (name, email, password_hash, google_id, picture, role, created_at)
        VALUES (?,?,?,?,?,?,?)`)
        .run(name || cleanEmail.split('@')[0], cleanEmail, null, googleId, picture || null, 'customer', Date.now());
      user = db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid);
    }
  } else {
    // Update nama/foto supaya sinkron dengan Google
    db.prepare('UPDATE users SET name=?, picture=? WHERE id=?')
      .run(name || user.name, picture || null, user.id);
  }

  createSession(res, user.id);
  res.json({
    id: user.id,
    name: name || user.name,
    email: user.email,
    role: user.role,
    picture: picture || user.picture || null
  });
}));

app.post('/api/auth/logout', (req, res) => { destroySession(req, res); res.json({ ok: true }); });

app.get('/api/auth/me', requireAuth, (req, res) => {
  const u = db.prepare('SELECT id,name,email,phone,role,picture FROM users WHERE id=?').get(req.user.id);
  res.json(u);
});

/* =========================================================
   PROFIL & ALAMAT
   ========================================================= */
const profileInput = z.object({
  name: z.string().min(2).max(60),
  phone: z.string().max(20).optional().default('')
});

app.patch('/api/me', requireAuth, wrap((req, res) => {
  const parsed = profileInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Data profil tidak valid.' });
  const phone = parsed.data.phone ? normPhone(parsed.data.phone) : '';
  if (phone && !/^08\d{8,12}$/.test(phone))
    return res.status(400).json({ error: 'Nomor WhatsApp tidak valid.' });
  db.prepare('UPDATE users SET name=?, phone=? WHERE id=?')
    .run(parsed.data.name.trim(), phone, req.user.id);
  res.json({ ok: true });
}));

const passwordInput = z.object({
  current: z.string().min(1),
  next: z.string().min(8).max(200)
});

app.post('/api/me/password', requireAuth, loginLimiter, wrap(async (req, res) => {
  const parsed = passwordInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Kata sandi baru minimal 8 karakter.' });
  const me = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!me.password_hash)
    return res.status(400).json({ error: 'Akun ini masuk lewat Google. Kata sandi tidak dapat diubah di sini.' });
  if (!(await verifyPassword(me, parsed.data.current)))
    return res.status(401).json({ error: 'Kata sandi saat ini salah.' });
  if (parsed.data.current === parsed.data.next)
    return res.status(400).json({ error: 'Kata sandi baru harus berbeda.' });
  const hash = await hashPassword(parsed.data.next);
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash, req.user.id);
  res.json({ ok: true });
}));

app.get('/api/addresses', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT id,label,text,is_default FROM addresses WHERE user_id=? ORDER BY is_default DESC, rowid DESC')
    .all(req.user.id);
  res.json(rows.map(r => ({ id: r.id, label: r.label, text: r.text, defaultAddr: !!r.is_default })));
});

app.post('/api/addresses', requireAuth, wrap((req, res) => {
  const { label, text } = req.body || {};
  if (typeof text !== 'string' || text.trim().length < 10)
    return res.status(400).json({ error: 'Alamat minimal 10 karakter.' });
  const { n } = db.prepare('SELECT COUNT(*) n FROM addresses WHERE user_id=?').get(req.user.id);
  if (n >= 5) return res.status(400).json({ error: 'Maksimal 5 alamat tersimpan.' });
  const id = crypto.randomBytes(6).toString('hex');
  const isDefault = n === 0 ? 1 : 0;
  db.prepare('INSERT INTO addresses (id,user_id,label,text,is_default) VALUES (?,?,?,?,?)')
    .run(id, req.user.id, (label || 'Alamat').slice(0, 30), text.trim().slice(0, 200), isDefault);
  res.json({ id, label: (label || 'Alamat').slice(0, 30), text: text.trim().slice(0, 200), defaultAddr: !!isDefault });
}));

app.delete('/api/addresses/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT is_default FROM addresses WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Tidak ditemukan.' });
  db.prepare('DELETE FROM addresses WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
  if (row.is_default) {
    const next = db.prepare('SELECT id FROM addresses WHERE user_id=? ORDER BY rowid LIMIT 1').get(req.user.id);
    if (next) db.prepare('UPDATE addresses SET is_default=1 WHERE id=?').run(next.id);
  }
  res.json({ ok: true });
});

app.post('/api/addresses/:id/default', requireAuth, (req, res) => {
  const row = db.prepare('SELECT 1 FROM addresses WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Tidak ditemukan.' });
  db.prepare('UPDATE addresses SET is_default=0 WHERE user_id=?').run(req.user.id);
  db.prepare('UPDATE addresses SET is_default=1 WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

/* =========================================================
   KATALOG, SLOT, PROMO
   ========================================================= */
app.get('/api/catalog', (_req, res) => {
  res.json({
    services: SERVICES,
    slots: SLOTS,
    waNumber: WA_NUMBER,
    methods: METHODS,
    googleClientId: process.env.GOOGLE_CLIENT_ID || ''
  });
});

app.get('/api/slots', (req, res) => {
  const { date, mode } = req.query;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.json([]);
  if (mode !== 'Pickup' && mode !== 'Delivery') return res.json([]);
  const result = SLOTS.map(slot => {
    const { n } = db.prepare(`SELECT COUNT(*) n FROM orders
      WHERE scheduled_date=? AND scheduled_slot=? AND mode=? AND status<>'Dibatalkan'`)
      .get(date, slot, mode);
    return { slot, remaining: Math.max(0, 5 - n), full: n >= 5 };
  });
  res.json(result);
});

app.post('/api/promo/validate', requireAuth, wrap((req, res) => {
  const { code, serviceId, weight } = req.body || {};
  const s = SERVICES.find(x => x.id === serviceId);
  if (!s) return res.status(400).json({ error: 'Pilih layanan dulu.' });
  const w = Number(weight);
  if (!(w >= 1 && w <= 50)) return res.status(400).json({ error: 'Berat 1–50 kg.' });
  const r = validatePromo(req.user.id, code, Math.round(s.price * w));
  res.json(r);
}));

/* =========================================================
   ORDER
   ========================================================= */
const orderInput = z.object({
  serviceId: z.string().min(1),
  mode: z.enum(['Pickup', 'Delivery']),
  weight: z.number(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  slot: z.string(),
  telp: z.string().min(8).max(20),
  alamat: z.string().min(10).max(200),
  note: z.string().max(150).optional().default(''),
  promo: z.string().max(20).optional().default(''),
  payment: z.enum(['Online', 'COD'])
});

app.post('/api/orders', requireAuth, requireRole('customer', 'admin'), wrap((req, res) => {
  const parsed = orderInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Data pesanan tidak valid.' });
  const input = parsed.data;

  const phone = normPhone(input.telp);
  if (!/^08\d{8,12}$/.test(phone))
    return res.status(400).json({ error: 'Nomor WhatsApp tidak valid.' });

  const order = db.transaction(() => {
    assertSlotAvailable(input.date, input.slot, input.mode);
    const p = computePricing(input.serviceId, input.weight, req.user.id, input.promo);
    const code = newCode();
    const info = db.prepare(`INSERT INTO orders
      (code,user_id,service_id,service_name,price_per_kg,weight,subtotal,ship,discount,promo_code,total,
       status,mode,scheduled_date,scheduled_slot,telp,alamat,note,pay_status,payment_method,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(
        code, req.user.id,
        p.service.id, p.service.name, p.service.price,
        input.weight, p.subtotal, p.ship, p.discount, p.promoCode, p.total,
        STATUS[0], input.mode, input.date, input.slot,
        phone, input.alamat.trim(), input.note || '',
        input.payment === 'COD' ? 'COD' : 'Belum Dibayar',
        input.payment, Date.now()
      );
    return db.prepare('SELECT * FROM orders WHERE id=?').get(info.lastInsertRowid);
  })();

  res.json({
    code: order.code,
    total: order.total, subtotal: order.subtotal, ship: order.ship,
    discount: order.discount, promo: order.promo_code,
    serviceName: order.service_name, weight: order.weight,
    mode: order.mode, date: order.scheduled_date, slot: order.scheduled_slot,
    alamat: order.alamat, telp: order.telp, note: order.note,
    payStatus: order.pay_status, payment: order.payment_method
  });
}));

function orderScope(req) {
  if (req.user.role === 'admin') return { where: '', params: [] };
  if (req.user.role === 'staff')
    return { where: 'WHERE (o.assigned_staff_id = ? OR o.assigned_staff_id IS NULL)', params: [req.user.id] };
  return { where: 'WHERE o.user_id = ?', params: [req.user.id] };
}

function mapOrder(o) {
  return {
    code: o.code,
    serviceId: o.service_id,
    serviceName: o.service_name,
    pricePerKg: o.price_per_kg,
    weight: o.weight,
    subtotal: o.subtotal,
    ship: o.ship,
    discount: o.discount,
    promo: o.promo_code,
    total: o.total,
    status: o.status,
    mode: o.mode,
    date: o.scheduled_date,
    slot: o.scheduled_slot,
    telp: o.telp,
    alamat: o.alamat,
    note: o.note,
    assignedStaff: o.staff_name || 'Belum ditugaskan',
    assignedStaffEmail: o.staff_email || '',
    assignedStaffId: o.assigned_staff_id,
    payStatus: o.pay_status,
    payment: o.payment_method,
    payRef: o.payment_ref,
    fee: o.payment_fee,
    grand: o.grand_total || o.total,
    paidAt: o.paid_at ? new Date(o.paid_at).toISOString() : null,
    createdAt: new Date(o.created_at).toISOString(),
    cancelledAt: o.cancelled_at ? new Date(o.cancelled_at).toISOString() : null,
    owner: o.owner_name,
    ownerTelp: o.owner_phone,
    email: o.owner_email,
    review: o.review_rating ? {
      rating: o.review_rating,
      text: o.review_text,
      hidden: !!o.review_hidden,
      at: o.review_created ? new Date(o.review_created).toISOString() : null
    } : null
  };
}

const orderSelect = `SELECT o.*,
  u.name AS owner_name, u.email AS owner_email, u.phone AS owner_phone,
  s.name AS staff_name, s.email AS staff_email,
  r.rating AS review_rating, r.text AS review_text, r.hidden AS review_hidden, r.created_at AS review_created
  FROM orders o
  JOIN users u ON u.id = o.user_id
  LEFT JOIN users s ON s.id = o.assigned_staff_id
  LEFT JOIN reviews r ON r.order_id = o.id`;

app.get('/api/orders', requireAuth, (req, res) => {
  const { where, params } = orderScope(req);
  const rows = db.prepare(`${orderSelect} ${where} ORDER BY o.created_at DESC`).all(...params);
  res.json(rows.map(mapOrder));
});

app.get('/api/orders/:code', requireAuth, (req, res) => {
  const o = db.prepare(`${orderSelect} WHERE o.code=?`).get(req.params.code);
  if (!o) return res.status(404).json({ error: 'Tidak ditemukan.' });
  const allowed = req.user.role === 'admin'
    || o.user_id === req.user.id
    || (req.user.role === 'staff' && (o.assigned_staff_id === req.user.id || o.assigned_staff_id === null));
  if (!allowed) return res.status(403).json({ error: 'forbidden' });
  res.json(mapOrder(o));
});

app.post('/api/orders/:code/cancel', requireAuth, (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE code=?').get(req.params.code);
  if (!o) return res.status(404).json({ error: 'Tidak ditemukan.' });
  if (o.user_id !== req.user.id && req.user.role !== 'admin')
    return res.status(403).json({ error: 'forbidden' });
  if (o.status !== STATUS[0]) return res.status(409).json({ error: 'Pesanan sudah diproses.' });
  const payStatus = o.pay_status === 'Lunas' ? 'Menunggu Refund' : CANCELLED;
  db.prepare('UPDATE orders SET status=?, cancelled_at=?, pay_status=?, assigned_staff_id=NULL WHERE id=?')
    .run(CANCELLED, Date.now(), payStatus, o.id);
  res.json({ ok: true, payStatus });
});

app.post('/api/orders/:code/take', requireAuth, requireRole('staff', 'admin'), (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE code=?').get(req.params.code);
  if (!o || o.assigned_staff_id) return res.status(409).json({ error: 'Tidak bisa diambil.' });
  if (o.status === CANCELLED) return res.status(409).json({ error: 'Pesanan dibatalkan.' });
  db.prepare('UPDATE orders SET assigned_staff_id=? WHERE id=?').run(req.user.id, o.id);
  res.json({ ok: true });
});

app.post('/api/orders/:code/advance', requireAuth, requireRole('staff', 'admin'), (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE code=?').get(req.params.code);
  if (!o || o.status === CANCELLED || o.status === 'Selesai')
    return res.status(409).json({ error: 'Tidak bisa dilanjutkan.' });
  if (req.user.role === 'staff' && o.assigned_staff_id !== req.user.id)
    return res.status(403).json({ error: 'forbidden' });
  const next = STATUS[Math.min(STATUS.indexOf(o.status) + 1, STATUS.length - 1)];
  db.prepare('UPDATE orders SET status=? WHERE id=?').run(next, o.id);
  res.json({ status: next });
});

const adminPatch = z.object({
  status: z.enum(STATUS).optional(),
  staffId: z.union([z.number().int(), z.null()]).optional(),
  markPaid: z.boolean().optional(),
  refund: z.boolean().optional()
});

app.patch('/api/orders/:code', requireAuth, requireRole('admin'), wrap((req, res) => {
  const parsed = adminPatch.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Body tidak valid.' });
  const o = db.prepare('SELECT * FROM orders WHERE code=?').get(req.params.code);
  if (!o) return res.status(404).json({ error: 'Tidak ditemukan.' });

  const data = parsed.data;
  const sets = [], params = [];
  if (data.status) { sets.push('status=?'); params.push(data.status); }
  if ('staffId' in data) {
    if (data.staffId !== null) {
      const st = db.prepare("SELECT id FROM users WHERE id=? AND role='staff'").get(data.staffId);
      if (!st) return res.status(400).json({ error: 'Kurir tidak ditemukan.' });
    }
    sets.push('assigned_staff_id=?'); params.push(data.staffId);
  }
  if (data.markPaid && !['Lunas', 'Dikembalikan'].includes(o.pay_status)) {
    sets.push('pay_status=?', 'payment_ref=?', 'paid_at=?', 'grand_total=?');
    params.push('Lunas', 'MANUAL', Date.now(), (o.grand_total || o.total));
  }
  if (data.refund && o.pay_status === 'Menunggu Refund') {
    sets.push('pay_status=?'); params.push('Dikembalikan');
  }
  if (!sets.length) return res.json({ ok: true });
  params.push(o.id);
  db.prepare(`UPDATE orders SET ${sets.join(', ')} WHERE id=?`).run(...params);
  res.json({ ok: true });
}));

/* =========================================================
   ULASAN
   ========================================================= */
app.post('/api/orders/:code/review', requireAuth, wrap((req, res) => {
  const { rating, text } = req.body || {};
  const r = Number(rating);
  if (!(r >= 1 && r <= 5)) return res.status(400).json({ error: 'Rating 1–5.' });
  const o = db.prepare('SELECT * FROM orders WHERE code=? AND user_id=?').get(req.params.code, req.user.id);
  if (!o) return res.status(404).json({ error: 'Tidak ditemukan.' });
  if (o.status !== 'Selesai') return res.status(409).json({ error: 'Pesanan belum selesai.' });
  db.prepare(`INSERT OR REPLACE INTO reviews (order_id,user_id,rating,text,hidden,created_at)
    VALUES (?,?,?,?,0,?)`)
    .run(o.id, req.user.id, r, String(text || '').slice(0, 300), Date.now());
  res.json({ ok: true });
}));

app.post('/api/orders/:code/review-hide', requireAuth, requireRole('admin'), (req, res) => {
  const { hidden } = req.body || {};
  const o = db.prepare('SELECT id FROM orders WHERE code=?').get(req.params.code);
  if (!o) return res.status(404).json({ error: 'Tidak ditemukan.' });
  const info = db.prepare('UPDATE reviews SET hidden=? WHERE order_id=?').run(hidden ? 1 : 0, o.id);
  if (!info.changes) return res.status(404).json({ error: 'Ulasan tidak ada.' });
  res.json({ ok: true });
});

app.get('/api/testimonials', (_req, res) => {
  const rows = db.prepare(`
    SELECT r.rating, r.text, r.created_at, u.name, o.service_name
    FROM reviews r
    JOIN users u ON u.id = r.user_id
    JOIN orders o ON o.id = r.order_id
    WHERE r.hidden=0 AND r.rating>=4 AND r.text IS NOT NULL AND r.text<>''
    ORDER BY r.created_at DESC LIMIT 6`).all();
  res.json(rows.map(r => ({
    rating: r.rating, text: r.text, name: r.name, service: r.service_name,
    at: new Date(r.created_at).toISOString()
  })));
});

/* =========================================================
   USERS (admin)
   ========================================================= */
app.get('/api/users', requireAuth, requireRole('admin'), (req, res) => {
  const { role } = req.query;
  const rows = role
    ? db.prepare('SELECT id,name,email,role FROM users WHERE role=? ORDER BY name').all(role)
    : db.prepare('SELECT id,name,email,role FROM users ORDER BY role,name').all();
  res.json(rows);
});

/* =========================================================
   PEMBAYARAN
   ========================================================= */
app.post('/api/orders/:code/pay', requireAuth, wrap(async (req, res) => {
  const method = String(req.body?.method || '');
  const o = db.prepare('SELECT * FROM orders WHERE code=? AND user_id=?').get(req.params.code, req.user.id);
  if (!o) return res.status(404).json({ error: 'Tidak ditemukan.' });
  if (o.status === CANCELLED) return res.status(409).json({ error: 'Pesanan dibatalkan.' });
  if (o.pay_status === 'Lunas') return res.json({ alreadyPaid: true });

  const fee = feeOf(method, o.total);
  const grand = o.total + fee;

  if (!process.env.MIDTRANS_SERVER_KEY) {
    if (!SIMULATED) {
      return res.status(503).json({ error: 'Gateway pembayaran belum dikonfigurasi.' });
    }
    db.prepare(`UPDATE orders SET pay_status=?, payment_method=?, payment_ref=?,
      payment_fee=?, grand_total=?, paid_at=? WHERE id=?`)
      .run('Lunas', `SIMULASI (${method || 'manual'})`,
           'SIMULATED-' + Date.now(), fee, grand, Date.now(), o.id);
    return res.json({ simulated: true, fee, grand });
  }

  const auth = Buffer.from(process.env.MIDTRANS_SERVER_KEY + ':').toString('base64');
  const isProd = process.env.MIDTRANS_MODE === 'production';
  const url = isProd
    ? 'https://app.midtrans.com/snap/v1/transactions'
    : 'https://app.sandbox.midtrans.com/snap/v1/transactions';

  const body = {
    transaction_details: { order_id: o.code, gross_amount: grand },
    customer_details: { first_name: req.user.name, email: req.user.email, phone: o.telp },
    item_details: [
      { id: o.service_id, price: o.total, quantity: 1, name: o.service_name },
      { id: 'fee', price: fee, quantity: 1, name: 'Biaya layanan' }
    ]
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + auth },
    body: JSON.stringify(body)
  });
  if (!resp.ok) return res.status(502).json({ error: 'Gagal membuat transaksi pembayaran.' });
  const snap = await resp.json();

  db.prepare('UPDATE orders SET payment_method=?, payment_ref=?, payment_fee=?, grand_total=? WHERE id=?')
    .run(method || 'Midtrans Snap', snap.token, fee, grand, o.id);

  res.json({ token: snap.token, redirect_url: snap.redirect_url, fee, grand });
}));

function midtransWebhook(req, res) {
  let body;
  try { body = JSON.parse(req.body.toString('utf8')); }
  catch { return res.status(400).end(); }

  const { order_id, status_code, gross_amount, signature_key, transaction_status, fraud_status, transaction_id } = body;
  const serverKey = process.env.MIDTRANS_SERVER_KEY;
  if (!serverKey) return res.status(500).json({ error: 'Server key belum dikonfigurasi.' });

  const expected = crypto.createHash('sha512')
    .update(`${order_id}${status_code}${gross_amount}${serverKey}`).digest('hex');
  if (expected !== signature_key) return res.status(401).end();

  const o = db.prepare('SELECT * FROM orders WHERE code=?').get(order_id);
  if (!o) return res.status(404).end();

  const paid = transaction_status === 'settlement'
    || (transaction_status === 'capture' && fraud_status === 'accept');

  if (paid && o.pay_status !== 'Lunas') {
    db.prepare('UPDATE orders SET pay_status=?, payment_ref=?, paid_at=? WHERE id=?')
      .run('Lunas', transaction_id || o.payment_ref, Date.now(), o.id);
  }
  res.json({ ok: true });
}

/* =========================================================
   ERROR
   ========================================================= */
app.use((err, _req, res, _next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Server error.' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`CleanLoop → http://localhost:${port}`);
  if (!process.env.MIDTRANS_SERVER_KEY) {
    console.log(SIMULATED
      ? '⚠️  Mode SIMULASI pembayaran AKTIF (hanya untuk development).'
      : 'ℹ️  Gateway pembayaran belum dikonfigurasi.');
  }
  if (!process.env.GOOGLE_CLIENT_ID) {
    console.log('ℹ️  Google Sign-In belum dikonfigurasi (GOOGLE_CLIENT_ID kosong).');
  } else {
    console.log('✓  Google Sign-In aktif.');
  }
});