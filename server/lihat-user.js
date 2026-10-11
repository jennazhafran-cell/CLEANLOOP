import { db } from './db.js';

const users = db.prepare('SELECT id, name, email, role, google_id, picture, created_at FROM users ORDER BY id').all();

console.log('Total user:', users.length);
console.log('---');

for (const u of users) {
  console.log(`[${u.id}] ${u.name}`);
  console.log(`     Email  : ${u.email}`);
  console.log(`     Role   : ${u.role}`);
  console.log(`     Google : ${u.google_id ? 'terhubung' : 'belum'}`);
  console.log(`     Foto   : ${u.picture || '-'}`);
  console.log(`     Daftar : ${new Date(u.created_at).toLocaleString('id-ID')}`);
  console.log('');
}