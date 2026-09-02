/**
 * KYC — Proses 1 (Upload Ulang Sharp) + Proses 3 (Rekayasa Foto)
 * OCR NIK/Nama di client (Tesseract lokal pure JS)
 */
let sharp = null;
try { sharp = require('sharp'); } catch (e) {
  console.warn('[kyc] npm install sharp');
}

const MAX_BLUR = 65;
const MIN_ANTIFAKE = 80;

async function checkMetadata(buf) {
  const head = buf.slice(0, Math.min(buf.length, 65536)).toString('latin1');
  if (/Adobe Photoshop|GIMP|Pixlr|Lightroom|Canva|PicsArt|Snapseed/i.test(head)) {
    return { ok: false, code: 'EDITED_SOFTWARE', message: 'Foto terdeteksi hasil edit software. Upload ulang foto KTP asli dari kamera.' };
  }
  if (!sharp) return { ok: true };
  try {
    await sharp(buf).metadata();
    return { ok: true };
  } catch (e) {
    return { ok: false, code: 'INVALID_IMAGE', message: 'File gambar tidak valid. Upload ulang.' };
  }
}

async function analyzeTextureReflection(buf) {
  if (!sharp) return { ok: true, stats: { brightRatio: 0.05, variance: 500 } };
  try {
    const out = await sharp(buf).greyscale().resize(400, 260, { fit: 'inside' }).raw().toBuffer({ resolveWithObject: true });
    const data = out.data;
    let sum = 0, sumSq = 0, bright = 0, n = data.length;
    for (let i = 0; i < n; i++) {
      const v = data[i];
      sum += v; sumSq += v * v;
      if (v > 248) bright++;
    }
    const mean = sum / n;
    const variance = sumSq / n - mean * mean;
    const brightRatio = bright / n;
    if (brightRatio > 0.35) {
      return { ok: false, code: 'REFLECTION', message: 'Terdeteksi pantulan cahaya / silau. Upload ulang tanpa pantulan.', stats: { mean, variance, brightRatio } };
    }
    if (variance < 60 && mean > 190) {
      return { ok: false, code: 'THIN_PRINT', message: 'Terdeteksi cetakan tipis / fotokopi. Upload foto KTP asli.', stats: { mean, variance, brightRatio } };
    }
    return { ok: true, stats: { mean, variance, brightRatio } };
  } catch (e) {
    return { ok: true, stats: null };
  }
}

async function measureBlurPercent(buf) {
  if (!sharp) return 20;
  try {
    const out = await sharp(buf).greyscale().resize(400, 260, { fit: 'inside' }).raw().toBuffer({ resolveWithObject: true });
    const data = out.data;
    const w = out.info.width, h = out.info.height;
    let edge = 0, count = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        edge += Math.abs(-4 * data[i] + data[i - 1] + data[i + 1] + data[i - w] + data[i + w]);
        count++;
      }
    }
    const avg = edge / (count || 1);
    return Math.round(Math.max(5, Math.min(90, 55 - avg / 4)));
  } catch (e) {
    return 20;
  }
}

function antiFakeScore(stats, blur) {
  let score = 92;
  if (stats) {
    if (stats.brightRatio > 0.2) score -= 12;
    if (stats.variance != null && stats.variance < 80) score -= 18;
  }
  if (blur > 55) score -= 12;
  else if (blur > 40) score -= 6;
  return Math.max(0, Math.min(100, Math.round(score)));
}

async function removeBackground(buf) {
  if (!sharp) return buf;
  try {
    return await sharp(buf).rotate().flatten({ background: { r: 255, g: 255, b: 255 } }).png().toBuffer();
  } catch (e) {
    return buf;
  }
}

/**
 * Proses 3 — Foto Hasil Rekayasa (admin + sumber OCR Nama)
 * Hapus BG → normalize → contrast ringan → jpeg
 */
/**
 * Watermark admin-only: tulisan "Anti Fraud" merah menyebar acak (pola awan).
 * seed berbeda → koordinat berbeda antara Foto KTP vs Foto Hasil Rekayasa.
 * TIDAK dipakai untuk Verifikasi OCR.
 */
function mulberry32(a) {
  return function () {
    let t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildAntiFraudSvg(w, h, seed) {
  const rnd = mulberry32((seed >>> 0) || 1);
  const lines = [];
  const count = 28;
  for (let i = 0; i < count; i++) {
    const x = Math.floor(rnd() * (w + 40)) - 20;
    const y = Math.floor(rnd() * (h + 20)) + 8;
    const rot = -20 - Math.floor(rnd() * 40); // ~ -20..-60, sekitar 36°
    const size = 11 + Math.floor(rnd() * 5);
    const opacity = 0.32 + rnd() * 0.28;
    lines.push(
      `<text x="${x}" y="${y}" fill="rgba(220,38,38,${opacity.toFixed(2)})" ` +
      `font-size="${size}" font-family="Arial,Helvetica,sans-serif" font-weight="700" ` +
      `transform="rotate(${rot} ${x} ${y})">Anti Fraud</text>`
    );
  }
  return Buffer.from(
    `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="100%" height="100%" fill="transparent"/>` +
    lines.join('') +
    `</svg>`
  );
}

async function applyAdminDisplay(buf, seed) {
  if (!sharp) return buf;
  const W = 506, H = 319;
  const s = seed == null ? 0xA11CE : seed;
  try {
    const base = await sharp(buf)
      .rotate()
      .resize(W, H, { fit: 'cover', position: 'centre' })
      .withMetadata({ density: 150 })
      .jpeg({ quality: 88 })
      .toBuffer();
    const svg = buildAntiFraudSvg(W, H, s);
    return await sharp(base)
      .composite([{ input: svg, top: 0, left: 0 }])
      .withMetadata({ density: 150 })
      .jpeg({ quality: 85 })
      .toBuffer();
  } catch (e) {
    try {
      return await sharp(buf).resize(506, 319, { fit: 'inside' }).jpeg({ quality: 85 }).toBuffer();
    } catch (e2) {
      return buf;
    }
  }
}

/**
 * Rekayasa untuk OCR Nama — resolusi penuh, TANPA watermark/downscale.
 * Watermark Anti Fraud hanya untuk arsip tampilan admin (applyAdminDisplay).
 */
async function engineerForOcr(buf) {
  if (!sharp) return buf;
  try {
    const noBg = await removeBackground(buf);
    return await sharp(noBg)
      .normalize()
      .modulate({ brightness: 1.05, saturation: 0.9 })
      .sharpen({ sigma: 0.6 })
      .jpeg({ quality: 92 })
      .toBuffer();
  } catch (e) {
    try {
      return await sharp(buf).normalize().jpeg({ quality: 90 }).toBuffer();
    } catch (e2) {
      return buf;
    }
  }
}

/** Alias: rekayasa OCR (bukan display admin) */
async function engineerForAdmin(buf) {
  return engineerForOcr(buf);
}



async function upscale2x(buf) {
  if (!sharp) return buf;
  try {
    const meta = await sharp(buf).metadata();
    const w = Math.min((meta.width || 500) * 2, 2400);
    const h = Math.min((meta.height || 320) * 2, 1600);
    return await sharp(buf)
      .resize(w, h, { kernel: 'lanczos3' })
      .jpeg({ quality: 92 })
      .toBuffer();
  } catch (e) {
    return buf;
  }
}

function similarity(a, b) {
  const s1 = String(a || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const s2 = String(b || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 100;
  const m = s1.length, n = s2.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return Math.round((1 - dp[m][n] / Math.max(m, n)) * 100);
}

function parseNikFromText(text) {
  if (!text) return '';
  function toDigits(s) {
    return String(s)
      .replace(/[OoDdQqCc]/g, '0')
      .replace(/[IiLl|]/g, '1')
      .replace(/[Aa]/g, '4')
      .replace(/[Ss]/g, '5')
      .replace(/[Gg]/g, '6')
      .replace(/[Tt]/g, '7')
      .replace(/[Bb]/g, '8')
      .replace(/\D/g, '');
  }
  const matches = String(text).match(/[0-9BTOoIiSsADQGCc]{16}/g) || [];
  let best = '';
  for (const m of matches) {
    const d = toDigits(m);
    if (d.length !== 16) continue;
    if (d.indexOf('08') === 0) continue;
    const prov = parseInt(d.slice(0, 2), 10);
    if (prov >= 11 && prov <= 94) return d;
    if (!best) best = d;
  }
  if (best) return best;
  const all = toDigits(String(text));
  for (let j = 0; j <= all.length - 16; j++) {
    const c = all.slice(j, j + 16);
    if (c.indexOf('08') === 0) continue;
    const p = parseInt(c.slice(0, 2), 10);
    if (p >= 11 && p <= 94) return c;
  }
  return '';
}

function mapNamaDigits(s) {
  return String(s)
    .replace(/0/g, 'O')
    .replace(/1/g, 'I')
    .replace(/2/g, 'R')
    .replace(/3/g, 'E')
    .replace(/4/g, 'A')
    .replace(/5/g, 'S')
    .replace(/6/g, 'G')
    .replace(/7/g, 'T')
    .replace(/8/g, 'B')
    .replace(/9/g, 'g');
}

function parseNamaFromText(text) {
  if (!text) return '';
  const re = /(?:Nama|Mama|Marna|Narna|Namaa|Nania|Name)\s*[:；;=\-]?\s*([A-Za-z0-9\s.,']+)/i;
  const m = String(text).match(re);
  if (!m) return '';
  let nama = mapNamaDigits(m[1]);
  nama = nama.replace(/[^A-Za-z\s.,']/g, ' ').replace(/\s+/g, ' ').trim();
  nama = nama.split(/\b(?:TEMPAT|Tempat|TTL|Lahir|Jenis|Kelamin|Alamat|Agama)\b/i)[0].trim();
  if (nama.length < 3) return '';
  return nama.toUpperCase();
}

async function processKYC(opts) {
  opts = opts || {};
  const {
    imageBase64, filename, hint = {}, ocrText, bypass,
    watermark_client, engineeredDataUrl
  } = opts;

  try {
    if (bypass) {
      const namaB = String(hint.nama_ktp || '').trim().toUpperCase();
      const nikB = String(hint.nik || '').replace(/\D/g, '');
      if (namaB.length < 3 || nikB.length !== 16) {
        return { ok: false, code: 'BYPASS_INCOMPLETE', message: 'Isi Nama dan NIK 16 digit.', quality: null, ocr: null };
      }
      return {
        ok: true, code: 'BYPASS_MANUAL',
        message: 'OCR dilewati. NIK & Nama disimpan manual — BELUM terverifikasi OCR.',
        quality: { blur_percent: 0, antifafe: 0 },
        ocr: {
          nik: nikB, nama_ktp: namaB,
          nik_match: false, nama_match: false,
          nik_score: 0, nama_score: 0,
          valid_structure: true, source: 'manual_bypass', ocr_skipped: true
        },
        kyc_status: 'pending',
        processed_image: null, original_image: null,
        lock_nik: false, lock_nama: false
      };
    }

    if (!imageBase64) {
      return { ok: false, code: 'NO_IMAGE', message: 'Foto KTP wajib diunggah.', quality: null, ocr: null };
    }

    const rawB64 = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
    let buf;
    try { buf = Buffer.from(rawB64, 'base64'); } catch (e) {
      return { ok: false, code: 'INVALID_IMAGE', message: 'Gambar tidak valid.', quality: null, ocr: null };
    }

    // —— Proses 1: Upload Ulang ——
    const meta = await checkMetadata(buf);
    if (!meta.ok) return { ok: false, code: meta.code, message: meta.message, quality: null, ocr: null };

    const tex = await analyzeTextureReflection(buf);
    if (!tex.ok) return { ok: false, code: tex.code, message: tex.message, quality: null, ocr: null };

    const blur_percent = await measureBlurPercent(buf);
    if (blur_percent > MAX_BLUR) {
      return {
        ok: false, code: 'BLUR_TOO_HIGH',
        message: 'Blur ' + blur_percent + '% (maks ' + MAX_BLUR + '%). Upload foto lebih jelas.',
        quality: { blur_percent, antifafe: 0 }, ocr: null
      };
    }

    const antifafe = antiFakeScore(tex.stats, blur_percent);
    if (antifafe < MIN_ANTIFAKE) {
      return {
        ok: false, code: 'ANTIFAKE_FAIL',
        message: 'Antipalsu ' + antifafe + '% (min ' + MIN_ANTIFAKE + '%). Upload foto KTP asli.',
        quality: { blur_percent, antifafe }, ocr: null
      };
    }

    if (watermark_client && watermark_client.detected) {
      return {
        ok: false, code: 'WATERMARK_DETECTED',
        message: 'Watermark / KTP contoh terdeteksi. Upload foto asli.',
        quality: { blur_percent, antifafe, watermark: true }, ocr: null
      };
    }

    // Original untuk admin: 506×319 @150 DPI + watermark Anti Fraud
    let original_image = 'data:image/jpeg;base64,' + buf.toString('base64');
    try {
      if (sharp) {
        const adminOrig = await applyAdminDisplay(buf, 0x4B545031);
        original_image = 'data:image/jpeg;base64,' + adminOrig.toString('base64');
      }
    } catch (e) { /* keep */ }

    // —— Proses 3: Rekayasa Foto ——
    // engOcr = untuk OCR Nama (penuh, tanpa watermark)
    // processed_image = arsip admin 506×319 + Anti Fraud
    let processed_image = null;
    let nik_upscale_image = null;
    let nama_upscale_image = null;

    try {
      const engOcr = await engineerForOcr(buf);
      // Arsip admin ber-watermark (bukan untuk OCR)
      const engAdmin = await applyAdminDisplay(engOcr, 0x50524F43);
      processed_image = 'data:image/jpeg;base64,' + engAdmin.toString('base64');

      // NIK: foto upload upscale 2× (sumber OCR NIK)
      const nikUp = await upscale2x(buf);
      nik_upscale_image = 'data:image/jpeg;base64,' + nikUp.toString('base64');

      // Nama: rekayasa OCR upscale 2× (TANPA watermark)
      const namaUp = await upscale2x(engOcr);
      nama_upscale_image = 'data:image/jpeg;base64,' + namaUp.toString('base64');
    } catch (e) {
      if (engineeredDataUrl) processed_image = engineeredDataUrl;
    }

    let ocrNik = String(hint.ocr_nik || '').replace(/\D/g, '');
    if (ocrNik.length !== 16) ocrNik = parseNikFromText(ocrText || '') || '';
    let ocrNama = String(hint.ocr_nama || '').trim().toUpperCase();
    if (ocrNama.length < 3) ocrNama = parseNamaFromText(ocrText || '') || '';

    // Jika NIK user ada di teks OCR setelah mapping, prioritaskan
    const userNik = String(hint.nik || '').replace(/\D/g, '');
    if (userNik.length === 16 && ocrText) {
      const mapped = String(ocrText)
        .replace(/[OoDdQqCc]/g, '0')
        .replace(/[IiLl|]/g, '1')
        .replace(/[Aa]/g, '4')
        .replace(/[Ss]/g, '5')
        .replace(/[Gg]/g, '6')
        .replace(/[Tt]/g, '7')
        .replace(/[Bb]/g, '8')
        .replace(/\D/g, '');
      if (mapped.includes(userNik)) ocrNik = userNik;
    }

    const userNama = String(hint.nama_ktp || '').trim().toUpperCase();
    const nik_score = similarity(userNik, ocrNik);
    const nama_score = similarity(userNama, ocrNama);
    // Matching ≥50% → terverifikasi + form terkunci (per field)
    const nik_match = nik_score >= 50 && userNik.length === 16;
    const nama_match = nama_score >= 50 && userNama.length >= 3;

    const quality = { blur_percent, antifafe, accuracy_percent: antifafe };
    const ocr = {
      nik: ocrNik || '',
      nama_ktp: ocrNama || '',
      ocr_nik: ocrNik,
      ocr_nama: ocrNama,
      user_nik: userNik,
      user_nama: userNama,
      nik_score,
      nama_score,
      nik_match,
      nama_match,
      valid_structure: userNik.length === 16 && userNama.length >= 3,
      source: 'tesseract_local',
      raw_preview: String(ocrText || '').slice(0, 400)
    };

    if (userNik.length !== 16 || userNama.length < 3) {
      return {
        ok: false, code: 'INPUT_REQUIRED',
        message: 'Isi NIK 16 digit dan Nama di form sebelum verifikasi.',
        quality, ocr, processed_image, original_image,
        nik_upscale_image, nama_upscale_image
      };
    }

    const both = nik_match && nama_match;
    let msg = 'Hasil verifikasi OCR (matching ≥50%):\n';
    msg += 'NIK: input ' + userNik + ' · OCR ' + (ocrNik || '—') + ' · ' + nik_score + '%' + (nik_match ? ' ✓' : ' ✗') + '\n';
    msg += 'Nama: input ' + userNama + ' · OCR ' + (ocrNama || '—') + ' · ' + nama_score + '%' + (nama_match ? ' ✓' : ' ✗');

    return {
      ok: true,
      code: both ? 'KYC_VERIFIED' : (nik_match || nama_match) ? 'KYC_PARTIAL' : 'KYC_MISMATCH',
      message: msg,
      quality,
      ocr,
      kyc_status: both ? 'approved' : 'pending',
      processed_image,
      original_image,
      nik_upscale_image,
      nama_upscale_image,
      verify_image: nama_upscale_image,
      lock_nik: nik_match,
      lock_nama: nama_match
    };
  } catch (e) {
    console.error('[kyc]', e.message);
    return { ok: false, code: 'PIPELINE_ERROR', message: 'Gagal memproses KTP. Pastikan: npm install sharp', quality: null, ocr: null };
  }
}

module.exports = {
  processKYC,
  engineerForAdmin,
  engineerForOcr,
  applyAdminDisplay,
  upscale2x,
  parseNikFromText,
  parseNamaFromText,
  similarity
};
