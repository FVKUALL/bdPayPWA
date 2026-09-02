# bdPay PWA

## Instalasi (Windows / macOS / Linux)

```bash
cd ppob-mobile-site
npm install
npm install sharp
npm start
```

Jika muncul `Cannot find module 'sharp'`, jalankan lagi:

```bash
npm install sharp --save
```

Di Windows, jika instalasi native gagal, server tetap bisa jalan (OCR vision penuh nonaktif; bypass OCR & Tesseract tetap aktif).

---
# PPOB Mobile Site

**Mobile Site PPOB (Payment Point Online Bank)** modern, minimalis, cocok untuk Tablet & Smartphone.  
Tanpa Database — Frontend LocalStorage + Backend JSON File Storage.  
Mudah dikonversi menjadi Aplikasi Seluler (PWA / Capacitor / Cordova).  
Mengikuti standar penulisan W3C (HTML5 valid, semantic, accessible).

**Copyright:** PT BERKAH DIGITAL PEMBAYARAN (dapat diedit via CMS)

---

## Fitur Utama

### Frontend
- Pendaftaran: **Email + Nama Pengguna** atau **Google Account** (quick login/register)
- **Akun Demo** 1-klik di modal login
- LocalStorage untuk session pengguna
- Kategori produk: **Prabayar** & **Pascabayar** (dapat diubah di Backend)
- FAQ yang dapat dikustomisasi sepenuhnya
- Tampilan modern minimalis, mobile-first, responsive tablet
- Persetujuan T&C saat daftar & Agreement saat pembelian
- PWA-ready (manifest + service worker)

### Backend (JSON File Storage)
- Integrasi OPEN API (simulasi/sandbox siap production):
  - **PPOB**: Digiflazz (prioritas), IAK, Raja-Biller
  - **Pembayaran**: bdPay (prioritas), Midtrans, DOKU, Xendit  
    (Virtual Account, QRIS, E-Wallet)
- **Automatic Switching + Fallback**: coba provider sesuai prioritas; gagal → pindah otomatis
- **Enkripsi AES-256-GCM** data sensitif (users, transactions, settings) at-rest
- **Verifikasi Callback** Digiflazz / bdPay / Midtrans / IAK (signature check)
- **Cetak Struk** HTML siap print (Frontend + Backend)
- **Laporan Penjualan** (filter tanggal, group by hari/bulan/produk/provider)
- Pengembalian dana otomatis (mock) ke rekening yang didaftarkan pengguna
- CRUD FORM lengkap untuk:
  - Produk (aktif/nonaktif, kategori, harga, fee)
  - FAQ
  - OPEN API Settings (kunci API, prioritas)
  - Biaya layanan (global % / fixed, siap per-produk)
  - CMS (hero, menu, konten) + SEO
  - T&C & Agreement (sesuai hukum Indonesia)
  - Copyright
- Admin panel terpisah (`/admin/`)

---

## Struktur Proyek

```
ppob-mobile-site/
├── data/                  # JSON File Storage (satu-satunya "database")
│   ├── users.json
│   ├── products.json
│   ├── faqs.json
│   ├── settings.json      # API keys, fees, T&C, copyright, SEO
│   ├── transactions.json
│   └── cms.json
├── public/                # Frontend static
│   ├── index.html
│   ├── css/style.css
│   ├── js/app.js
│   ├── admin/             # Admin panel
│   ├── assets/
│   ├── manifest.json
│   └── sw.js
├── server.js              # Express backend
├── package.json
├── README.md              # File ini
└── docs/                  # Panduan lengkap
```

---

## Instalasi & Menjalankan

### Prasyarat
- Node.js 18+ (disarankan 20 LTS)
- npm

### Langkah

```bash
cd ppob-mobile-site
npm install
npm start
```

Buka: **http://localhost:3000**

Admin: **http://localhost:3000/admin/**  
Default login: `admin` / `admin123`  
(Ganti segera di Settings atau edit `data/settings.json`)

---

## Cara Kerja Penyimpanan

- **Frontend**: LocalStorage hanya menyimpan data user yang sedang login (session).
- **Backend**: Semua data persisten disimpan di file JSON di folder `data/`.
  - Atomic write sederhana via `fs.writeFileSync`.
  - Cocok untuk prototipe, demo, dan skala kecil-menengah.
  - Untuk production skala besar, migrasi ke database (MongoDB/PostgreSQL) mudah karena struktur data sudah JSON.

---

## Integrasi API (Production)

Semua integrasi saat ini bersifat **simulasi** (random success/fail, auto-switch berdasarkan prioritas).

Untuk mengaktifkan production:

1. Daftar akun di provider:
   - Digiflazz: https://digiflazz.com
   - IAK: https://iak.id
   - bdPay: https://bdpay.co.id
   - Midtrans / DOKU / Xendit sesuai kebutuhan
2. Masuk Admin → **API & Settings**
3. Isi Username / API Key / Merchant Code
4. Centang "Aktifkan"
5. Atur urutan prioritas (contoh: `digiflazz,iak`)
6. Ubah `mode` di `settings.json` ke `production` dan sesuaikan base_url jika perlu

**Catatan penting**: Implementasi real API call (signature Digiflazz SHA256, IAK MD5, dll) perlu ditambahkan di `server.js` sesuai dokumentasi resmi masing-masing provider. Struktur prioritas & switching sudah disiapkan.

---

## Konversi ke Aplikasi Seluler

### Opsi 1: PWA (Paling Mudah)
1. Deploy ke HTTPS
2. Buka di Chrome/Safari → "Add to Home Screen"
3. Sudah seperti app native (standalone)

### Opsi 2: Capacitor (Recommended)
```bash
npm install -g @capacitor/cli
npx cap init
npx cap add android
npx cap add ios
# Build frontend dulu, lalu
npx cap sync
npx cap open android
```

### Opsi 3: Cordova / PhoneGap
Mirip, gunakan `cordova create` lalu copy isi `public/` ke `www/`.

Desain sudah mobile-first + viewport + touch-friendly sehingga konversi sangat mulus.

---

## Standar W3C & Best Practice

- HTML5 semantic (`<header>`, `<main>`, `<section>`, `<footer>`)
- Valid meta viewport, charset, lang="id"
- Progressive enhancement
- Aksesibilitas dasar (label form, aria-label menu)
- CSS modern tanpa framework berat (mudah di-maintain)
- Tidak ada inline style kritis, separation of concerns

---

## Hukum Indonesia (T&C & Agreement)

Teks default sudah disusun mengacu pada:
- UU No. 11 Tahun 2008 jo. UU No. 19 Tahun 2016 tentang Informasi dan Transaksi Elektronik (UU ITE)
- UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi (UU PDP)
- UU Perlindungan Konsumen
- Peraturan Bank Indonesia terkait sistem pembayaran

**Disarankan**: Konsultasikan dengan penasihat hukum sebelum production untuk penyesuaian spesifik bisnis Anda. Teks dapat diedit sepenuhnya di Admin → T&C / Agreement.

---

## Keamanan Catatan

- Admin auth sederhana (Basic-like via header). Ganti password default.
- Untuk production: tambahkan JWT, rate limiting, HTTPS wajib, validasi input lebih ketat, IP whitelist provider.
- Jangan commit file `data/settings.json` yang berisi API key nyata ke public repo.

---

## Lisensi & Copyright

Copyright mobile site dapat diubah melalui Admin CMS.  
Default: **PT BERKAH DIGITAL PEMBAYARAN**

Kode sumber ini dibuat sebagai solusi siap pakai sesuai permintaan.

---

## Support & Pengembangan Lanjutan

Dokumentasi lengkap di folder `docs/`:

| File | Isi |
|------|-----|
| STRUKTUR_PROJECT.md | Struktur folder & teknologi |
| FITUR.md | Daftar fitur Frontend & Backend |
| OPEN_API_SETTING.md | Setting Digiflazz, IAK, bdPay, Midtrans, Google |
| GO_LIVE.md | Checklist production |
| PANDUAN_ADMIN.md | Cara pakai Admin Panel |
| PANDUAN_PENGGUNA.md | Cara daftar, login, beli, cetak struk |
| PANDUAN_LENGKAP.md | Enkripsi, switching, callback, laporan |
| KONVERSI_APLIKASI.md | Jadi PWA / Capacitor / Cordova |

Lihat folder `docs/` juga untuk:
- Panduan API Provider
- Checklist Production
- Cara migrasi ke Database
- Troubleshooting

Selamat menggunakan!


---
**Copyright:** PT BERKAH DIGITAL PEMBAYARAN  
**Pengembang:** PT AREK ATUR AMANAH - PLATFORM DEV @2026  
**Lisensi:** Proprietary

---

## Omnichannel

Satu backend Node.js, banyak kanal distribusi.  
Panduan lengkap: **[docs/OMNICHANNEL.md](docs/OMNICHANNEL.md)**

Folder: `omnichannel/` (Docker, Chrome, Electron, RN, PHP, WA, Telegram, PaaS, CLI, CF Worker, …)
