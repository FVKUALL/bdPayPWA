/**
 * Merchant UMKM Self-Service helpers
 */
const crypto = require('crypto');

const UMKM_LIMITS = {
  // Default sesuai kebijakan Admin
  mikro: { max_per_transfer: 50000000, max_per_day: 100000000, max_bulk: 10 },
  kecil: { max_per_transfer: 50000000, max_per_day: 450000000, max_bulk: 10 },
  menengah: { max_per_transfer: 50000000, max_per_day: 2000000000, max_bulk: 10 }
};

const AML_THRESHOLDS = {
  mikro: { max_omset_harian: 5000000, max_karyawan: 5 },
  kecil: { max_omset_harian: 25000000, max_karyawan: 20 },
  menengah: { max_omset_harian: 100000000, max_karyawan: 100 }
};

function hashPassword(pw) {
  return crypto.createHash('sha256').update(String(pw) + ':bdpay-merchant').digest('hex');
}

function verifyPassword(pw, hash) {
  return hashPassword(pw) === hash;
}

function evaluateAML(scale, kuesioner) {
  const th = AML_THRESHOLDS[scale] || AML_THRESHOLDS.mikro;
  const omset = Number(kuesioner.omset_harian) || 0;
  const karyawan = Number(kuesioner.jumlah_karyawan) || 0;
  const issues = [];
  if (omset > th.max_omset_harian * 1.5) issues.push('Omset harian melebihi profil skala');
  if (karyawan > th.max_karyawan * 1.5) issues.push('Jumlah karyawan melebihi profil skala');
  return { pass: issues.length === 0, issues };
}

function registrationSteps() {
  return [
    'pic_register',
    'email_verify',
    'trade_name_verify',
    'kyc_ocr',
    'geo_location',
    'tnc_agree',
    'agreement_agree',
    'umkm_scale',
    'scale_verify',
    'kuesioner',
    'aml_pass',
    'agree_aml',
    'agree_consumer',
    'agree_infosec',
    'agree_cyber',
    'agree_law',
    'approved'
  ];
}

module.exports = {
  UMKM_LIMITS,
  AML_THRESHOLDS,
  hashPassword,
  verifyPassword,
  evaluateAML,
  registrationSteps
};
