# CleanLoop — Laundry Pickup & Delivery

Aplikasi fullstack: Express + SQLite + frontend statis.

## Setup pertama

```bash
# 1. Backend
cd server
npm install

# 2. Konfigurasi
cp ../.env.example ../.env
# edit ../.env — minimal ADMIN_EMAIL dan ADMIN_PASSWORD

# 3. Buat admin pertama
npm run seed

# 4. Jalankan
npm start
# → http://localhost:3000