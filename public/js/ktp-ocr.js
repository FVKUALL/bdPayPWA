/**
 * Pure JS lokal — tanpa CDN / API
 * Proses 2: NIK dari foto upload
 * Proses 4: Nama dari Foto Hasil Rekayasa
 */
(function (global) {
  'use strict';

  var VENDOR = '/vendor/tesseract';
  var WL_NIK = '0123456789BTOoIiSsADQGCc';
  var WL_NAMA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,;:'-";

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

  /** Regex: /[0-9BTOoIiSsADQGCc]{16}/g */
  function parseNik(text) {
    if (!text) return '';
    var matches = String(text).match(/[0-9BTOoIiSsADQGCc]{16}/g) || [];
    var best = '';
    for (var i = 0; i < matches.length; i++) {
      var d = toDigits(matches[i]);
      if (d.length !== 16) continue;
      if (d.indexOf('08') === 0) continue;
      var prov = parseInt(d.slice(0, 2), 10);
      if (prov >= 11 && prov <= 94) return d;
      if (!best) best = d;
    }
    if (best) return best;
    var all = toDigits(String(text));
    for (var j = 0; j <= all.length - 16; j++) {
      var c = all.slice(j, j + 16);
      if (c.indexOf('08') === 0) continue;
      var p = parseInt(c.slice(0, 2), 10);
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

  /**
   * Regex: /(?:Nama|Mama|Marna|Narna|Namaa|Nania|Name)\s*[:;-]?\s*([A-Za-z\s.,']+)/i
   */
  function isAddressNoise(s) {
    return /KOMPLEK|KOMPLEKS|REGENCY|BLOK|RT\/?RW|KELURAHAN|KECAMATAN|KABUPATEN|PROVINSI|JALAN|JL\.?|GG\.?|GANG|NO\.?\s*\d|SIDOARJO|JAKARTA|SURABAYA|BANDUNG|ALAMAT|TAMAN\s/i.test(s);
  }

  function parseNama(text) {
    if (!text) return '';
    var re = /(?:Nama|Mama|Marna|Narna|Namaa|Nania|Name)\s*[:；;=\-]?\s*([A-Za-z0-9\s.,']+)/i;
    var m = String(text).match(re);
    var nama = '';
    if (m && m[1]) nama = m[1];
    if (!nama || isAddressNoise(nama)) {
      var lines = String(text).replace(/\r/g, '\n').split(/\n|\|/);
      for (var i = 0; i < lines.length; i++) {
        if (/(?:Nama|Mama|Marna|Narna|Namaa|Nania|Name)/i.test(lines[i])) {
          var rest = lines[i].replace(/^.*?(?:Nama|Mama|Marna|Narna|Namaa|Nania|Name)\s*[:；;=\-]?\s*/i, '').trim();
          if (rest.length < 3 && i + 1 < lines.length) rest = (rest + ' ' + lines[i + 1]).trim();
          if (rest.length >= 3 && !isAddressNoise(rest)) { nama = rest; break; }
        }
      }
    }
    if (!nama) return '';
    nama = mapNamaDigits(nama);
    nama = nama.replace(/[^A-Za-z\s.,']/g, ' ').replace(/\s+/g, ' ').trim();
    // Potong di label field KTP berikutnya
    nama = nama.split(/\b(?:TEMPAT|Tempat|TTL|Lahir|Jenis|Kelamin|Alamat|Agama|Status|Pekerjaan|Gol\.?|Darah|NIK)\b/i)[0].trim();
    // Buang sisa alamat jika masih menempel
    if (isAddressNoise(nama)) return '';
    // Nama KTP biasanya 2–6 kata huruf
    var words = nama.split(/\s+/).filter(function (w) { return /^[A-Za-z.,']+$/.test(w) && w.length >= 1; });
    if (words.length < 2) return '';
    nama = words.slice(0, 6).join(' ');
    return nama.length >= 3 ? nama.toUpperCase() : '';
  }

  async function createWorker(whitelist, onProgress) {
    if (!global.Tesseract) throw new Error('Tesseract lokal belum dimuat (/vendor/tesseract)');
    var worker = await Tesseract.createWorker(['ind', 'eng'], 1, {
      workerPath: VENDOR + '/worker.min.js',
      corePath: VENDOR + '/tesseract-core.wasm.js',
      langPath: VENDOR + '/lang',
      logger: function (m) {
        if (onProgress && m.status === 'recognizing text' && m.progress != null) {
          onProgress(Math.round(m.progress * 100));
        }
      }
    });
    await worker.setParameters({
      tessedit_char_whitelist: whitelist,
      tessedit_pageseg_mode: '6',
      preserve_interword_spaces: '1',
      user_defined_dpi: '300'
    });
    return worker;
  }

  /** Proses 2: NIK dari foto upload */
  async function recognizeNik(imageDataUrl, onProgress) {
    var worker = null;
    try {
      worker = await createWorker(WL_NIK, onProgress);
      var r = await worker.recognize(imageDataUrl);
      var text = (r.data && r.data.text) ? String(r.data.text).trim() : '';
      return { ocrText: text, nik: parseNik(text) };
    } finally {
      if (worker) { try { await worker.terminate(); } catch (e) {} }
      worker = null;
    }
  }

  /** Proses 4: Nama dari Foto Hasil Rekayasa */
  async function recognizeNama(imageDataUrl, onProgress) {
    var worker = null;
    try {
      worker = await createWorker(WL_NAMA, onProgress);
      var r = await worker.recognize(imageDataUrl);
      var text = (r.data && r.data.text) ? String(r.data.text).trim() : '';
      await worker.setParameters({ tessedit_pageseg_mode: '4' });
      var r2 = await worker.recognize(imageDataUrl);
      var text2 = (r2.data && r2.data.text) ? String(r2.data.text).trim() : '';
      var combined = text + '\n' + text2;
      return { ocrText: combined, nama_ktp: parseNama(combined) || parseNama(text) };
    } finally {
      if (worker) { try { await worker.terminate(); } catch (e) {} }
      worker = null;
    }
  }

  global.KtpOcr = {
    recognizeNik: recognizeNik,
    recognizeNama: recognizeNama,
    recognizeNikFromOriginal: recognizeNik,
    recognizeNamaFromEngineered: recognizeNama,
    parseNik: parseNik,
    parseNama: parseNama,
    toDigits: toDigits
  };
})(typeof window !== 'undefined' ? window : globalThis);
