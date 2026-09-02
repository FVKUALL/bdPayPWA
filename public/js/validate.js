/**
 * Validasi & sanitasi input — Frontend / Admin / Merchant (shared)
 */
(function (global) {
  function stripTags(s) {
    return String(s == null ? '' : s).replace(/[<>]/g, '');
  }
  function isEmail(s) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());
  }
  function isNik(s) {
    return /^\d{16}$/.test(String(s || '').replace(/\D/g, ''));
  }
  function isPin6(s) {
    return /^\d{6}$/.test(String(s || ''));
  }
  function isPhone(s) {
    const d = String(s || '').replace(/\D/g, '');
    return d.length >= 10 && d.length <= 15;
  }
  function amountOf(s) {
    const n = Number(String(s || '').replace(/[^\d]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }
  function sanitizeForm(form) {
    if (!form) return {};
    const fd = new FormData(form);
    const out = {};
    fd.forEach((v, k) => { out[k] = stripTags(v).trim(); });
    return out;
  }
  function requireFields(obj, fields) {
    const missing = [];
    (fields || []).forEach((f) => {
      if (obj[f] == null || String(obj[f]).trim() === '') missing.push(f);
    });
    return missing;
  }
  function showFieldError(el, msg) {
    if (!el) return;
    el.classList.add('input-invalid');
    el.setAttribute('aria-invalid', 'true');
    let h = el.parentElement && el.parentElement.querySelector('.field-error');
    if (!h && el.parentElement) {
      h = document.createElement('div');
      h.className = 'field-error';
      h.style.cssText = 'color:#dc2626;font-size:.8rem;margin-top:4px';
      el.parentElement.appendChild(h);
    }
    if (h) h.textContent = msg || 'Tidak valid';
  }
  function clearFieldError(el) {
    if (!el) return;
    el.classList.remove('input-invalid');
    el.removeAttribute('aria-invalid');
    const h = el.parentElement && el.parentElement.querySelector('.field-error');
    if (h) h.textContent = '';
  }
  global.BdValidate = {
    stripTags, isEmail, isNik, isPin6, isPhone, amountOf,
    sanitizeForm, requireFields, showFieldError, clearFieldError
  };
})(typeof window !== 'undefined' ? window : globalThis);
