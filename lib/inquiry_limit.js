/** Jeda inquiry 3 menit per user (semua fitur inquiry) */
const COOLDOWN_MS = 3 * 60 * 1000;
const lastInquiry = new Map(); // userId|ip → timestamp

function checkInquiryCooldown(key) {
  const k = String(key || 'anon');
  const last = lastInquiry.get(k) || 0;
  const now = Date.now();
  const remain = COOLDOWN_MS - (now - last);
  if (remain > 0) {
    return {
      allowed: false,
      retry_after_seconds: Math.ceil(remain / 1000),
      message: `Inquiry dibatasi: 1 kali per 3 menit. Coba lagi dalam ${Math.ceil(remain / 1000)} detik.`
    };
  }
  return { allowed: true };
}

function markInquiry(key) {
  lastInquiry.set(String(key || 'anon'), Date.now());
}

module.exports = { checkInquiryCooldown, markInquiry, COOLDOWN_MS };
