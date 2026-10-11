export const SERVICES = [
  { id:'regular', name:'Regular Laundry', desc:'Pakaian sehari-hari, bersih dan wangi.', price:8000,  icon:'i-shirt',  days:2, note:'Cuci, kering, setrika' },
  { id:'express', name:'Express Laundry', desc:'Proses cepat untuk kebutuhan mendesak.', price:12000, icon:'i-bolt',   days:1, note:'Selesai dalam 24 jam' },
  { id:'dry',     name:'Dry Cleaning',    desc:'Untuk pakaian khusus dan bahan premium.', price:20000, icon:'i-hanger', days:3, note:'Jas, gaun, kebaya' },
  { id:'bedbath', name:'Bed & Bath',      desc:'Seprai, selimut, handuk, dll.',           price:15000, icon:'i-bed',    days:2, note:'Seprai, selimut, handuk' }
];

export const SLOTS = ['09:00 - 12:00','12:00 - 15:00','15:00 - 18:00','18:00 - 21:00'];
export const SLOT_CAP = 5;
export const FREE_SHIP_KG = 5;
export const SHIP_FEE = 8000;
export const STATUS = ['Menunggu Penjemputan','Sedang Dicuci','Disetrika','Siap Diantar','Selesai'];
export const CANCELLED = 'Dibatalkan';

// GANTI dengan nomor WhatsApp bisnis Anda (format 62..., tanpa + atau spasi).
export const WA_NUMBER = '6285175309162';

export const METHODS = [
  ['QRIS', [['qris', 'QRIS · semua e-wallet & m-banking']]],
  ['Virtual Account', ['BCA','Mandiri','BNI','BRI','Permata'].map(b => ['va:' + b, 'VA ' + b])],
  ['E-Wallet', ['GoPay','OVO','DANA','ShopeePay','LinkAja'].map(b => ['ew:' + b, b])],
  ['Kartu', [['card', 'Kartu Kredit / Debit']]],
  ['Minimarket', ['Alfamart','Indomaret'].map(b => ['mm:' + b, b])]
];