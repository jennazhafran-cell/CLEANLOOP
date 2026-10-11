import { SERVICES, SLOTS, SLOT_CAP, FREE_SHIP_KG, SHIP_FEE } from './catalog.js';
import { db } from './db.js';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function feeOf(method, subtotal) {
  const m = String(method || '');
  if (m.startsWith('va:'))  return 4000;
  if (m.startsWith('ew:'))  return Math.round(subtotal * 0.015);
  if (m === 'qris')         return Math.round(subtotal * 0.007);
  if (m === 'card')         return Math.round(subtotal * 0.029 + 2000);
  if (m.startsWith('mm:'))  return 5000;
  return 0;
}

export function validatePromo(userId, codeRaw, subtotal) {
  const code = String(codeRaw || '').trim().toUpperCase();
  if (!code) return { code: '', amount: 0, label: '' };
  const p = db.prepare('SELECT * FROM promos WHERE code=? AND active=1').get(code);
  if (!p) throw new HttpError(400, 'Kode promo tidak dikenal.');
  if (p.min_subtotal && subtotal < p.min_subtotal)
    throw new HttpError(400, 'Minimal belanja promo tidak terpenuhi.');
  if (p.first_only) {
    const { n } = db.prepare(`SELECT COUNT(*) n FROM orders WHERE user_id=? AND status<>'Dibatalkan'`).get(userId);
    if (n > 0) throw new HttpError(400, 'Kode ini hanya untuk pesanan pertama.');
  }
  if (p.once_per_user) {
    const { n } = db.prepare(`SELECT COUNT(*) n FROM orders WHERE user_id=? AND promo_code=? AND status<>'Dibatalkan'`).get(userId, code);
    if (n > 0) throw new HttpError(400, 'Kode ini sudah pernah Anda pakai.');
  }
  let amount = p.kind === 'pct' ? Math.round(subtotal * p.value / 100) : p.value;
  if (p.max_amount) amount = Math.min(amount, p.max_amount);
  return { code, amount: Math.min(amount, subtotal), label: p.label };
}

export function assertSlotAvailable(date, slot, mode) {
  if (!SLOTS.includes(slot)) throw new HttpError(400, 'Slot waktu tidak valid.');
  const today = new Date().toISOString().slice(0, 10);
  if (date < today) throw new HttpError(400, 'Tanggal sudah lewat.');
  const { n } = db.prepare(`SELECT COUNT(*) n FROM orders
    WHERE scheduled_date=? AND scheduled_slot=? AND mode=? AND status<>'Dibatalkan'`)
    .get(date, slot, mode);
  if (n >= SLOT_CAP) throw new HttpError(409, 'Slot sudah penuh.');
}

export function computePricing(serviceId, weight, userId, promoCode) {
  const s = SERVICES.find(x => x.id === serviceId);
  if (!s) throw new HttpError(400, 'Layanan tidak dikenal.');
  const w = Number(weight);
  if (!(w >= 1 && w <= 50)) throw new HttpError(400, 'Berat 1–50 kg.');
  const subtotal = Math.round(s.price * w);
  const ship = w >= FREE_SHIP_KG ? 0 : SHIP_FEE;
  const promo = validatePromo(userId, promoCode, subtotal);
  return {
    service: s,
    subtotal, ship,
    discount: promo.amount,
    promoCode: promo.code,
    total: subtotal + ship - promo.amount
  };
}