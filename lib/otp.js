/**
 * OTP Email / SMS / WhatsApp
 * Demo: kode dikembalikan di response. Production: hubungkan Twilio / Fonnte / Wablas / dll.
 */
const crypto = require('crypto');

function generateOTP(length = 6) {
  return String(crypto.randomInt(0, 10 ** length)).padStart(length, '0');
}

function createOTPRecord(target, channel, settings) {
  const length = settings.otp?.length || 6;
  const expiry = settings.otp?.expiry_minutes || 10;
  const code = generateOTP(length);
  return {
    id: crypto.randomUUID(),
    target: String(target).trim().toLowerCase(),
    channel: channel || 'email', // email | sms | whatsapp
    code,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + expiry * 60 * 1000).toISOString(),
    used: false,
    attempts: 0
  };
}

function verifyOTPRecord(records, target, code, channel) {
  const t = String(target).trim().toLowerCase();
  const now = Date.now();
  const rec = records
    .filter(r => r.target === t && !r.used && (!channel || r.channel === channel))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
  if (!rec) return { ok: false, message: 'OTP tidak ditemukan. Minta OTP baru.' };
  if (new Date(rec.expires_at).getTime() < now) return { ok: false, message: 'OTP sudah kedaluwarsa.' };
  if (rec.attempts >= 5) return { ok: false, message: 'Terlalu banyak percobaan. Minta OTP baru.' };
  rec.attempts += 1;
  if (rec.code !== String(code).trim()) return { ok: false, message: 'Kode OTP salah.' };
  rec.used = true;
  return { ok: true, message: 'Verifikasi berhasil.', channel: rec.channel };
}

/** Kirim OTP (demo log; production API) */
async function dispatchOTP({ channel, target, code, settings }) {
  const cfg = settings.otp || {};
  // Production hooks:
  // SMS: cfg.sms_provider (twilio), WhatsApp: cfg.wa_provider (fonnte/wablas)
  console.log(`[OTP:${channel}] → ${target} code=${code}`);
  return { sent: true, simulated: true, channel, target };
}

module.exports = { generateOTP, createOTPRecord, verifyOTPRecord, dispatchOTP };
