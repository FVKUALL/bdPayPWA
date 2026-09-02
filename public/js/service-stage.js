/**
 * Per-service Demo / Sandbox / Production — satu badge saja per section aktif.
 */
(function () {
  let STAGE = null;
  let applying = false;

  async function fetchStage() {
    try {
      const r = await fetch('/api/public/service-stage');
      const j = await r.json();
      STAGE = (j && j.data) || j || {};
    } catch (_) {
      STAGE = { overall: 'sandbox', ppob: 'sandbox', payment: 'sandbox', remittance: 'sandbox' };
    }
    return STAGE;
  }

  function normalize(s) {
    s = String(s || 'sandbox').toLowerCase();
    if (s.indexOf('prod') >= 0) return 'production';
    if (s.indexOf('demo') >= 0) return 'demo';
    return 'sandbox';
  }

  function badgeHtml(key, label) {
    const stage = normalize((STAGE && (STAGE[key] || STAGE.overall)) || 'sandbox');
    const title = (label || key || 'Layanan') + ': ' + stage;
    return (
      '<span class="service-stage-badge ' + stage + '" data-svc="' + (key || '') + '" title="' + title + '">' +
      '● ' + stage.toUpperCase() +
      '</span>'
    );
  }

  function clearBadges(root) {
    const scope = root || document;
    scope.querySelectorAll('.service-stage-badge, .service-stage-wrap').forEach(function (n) {
      try { n.remove(); } catch (_) {}
    });
    const old = document.getElementById('bd-service-stage');
    if (old) old.remove();
  }

  function keyFromTitle(text) {
    text = String(text || '').toLowerCase();
    if (/remittance/.test(text)) return { key: 'remittance', label: 'Remittance' };
    if (/ppob|pulsa|token|pembelian/.test(text)) return { key: 'ppob', label: 'PPOB' };
    if (/invoice/.test(text)) return { key: 'payment', label: 'Invoice' };
    if (/disbursement|pencairan/.test(text)) return { key: 'payment', label: 'Disbursement' };
    if (/transfer request|domestic transfer|vendor|aktivasi saldo|pembayaran/.test(text)) {
      return { key: 'payment', label: 'Payment' };
    }
    return null;
  }

  /** Hanya pasang 1 badge pada h1 section yang aktif (merchant / admin / PWA). */
  function placeOneBadge(sectionEl, key, label) {
    if (!sectionEl || !key) return;
    const h1 = sectionEl.querySelector('h1, .page-title, .m-header-title');
    const target = h1 || sectionEl;
    if (target.querySelector('.service-stage-badge')) return;
    const span = document.createElement('span');
    span.innerHTML = badgeHtml(key, label);
    const badge = span.firstChild;
    if (!badge) return;
    badge.style.marginLeft = '8px';
    badge.style.verticalAlign = 'middle';
    badge.style.fontSize = '0.72rem';
    if (h1) h1.appendChild(badge);
    else {
      const wrap = document.createElement('div');
      wrap.className = 'service-stage-wrap';
      wrap.style.marginBottom = '8px';
      wrap.appendChild(badge);
      sectionEl.insertBefore(wrap, sectionEl.firstChild);
    }
  }

  async function applyAll() {
    if (applying) return;
    applying = true;
    try {
      await fetchStage();
      clearBadges();

      // Merchant: only active .m-section
      const activeM = document.querySelector('.m-section.active');
      if (activeM) {
        const titleEl = activeM.querySelector('h1');
        const mapped = keyFromTitle(titleEl ? titleEl.textContent : activeM.id);
        if (mapped) placeOneBadge(activeM, mapped.key, mapped.label);
        applying = false;
        return;
      }

      // Admin: only visible .section
      const activeA = document.querySelector('.section.active, .section:not(.hidden)');
      // Prefer section that is displayed
      let adminSec = null;
      document.querySelectorAll('.section').forEach(function (s) {
        if (s.style.display === 'none' || s.classList.contains('hidden')) return;
        if (!adminSec && s.offsetParent !== null) adminSec = s;
      });
      if (adminSec) {
        const titleEl = adminSec.querySelector('h1');
        const mapped = keyFromTitle(titleEl ? titleEl.textContent : '');
        if (mapped) placeOneBadge(adminSec, mapped.key, mapped.label);
      }

      // PWA home cards: max 1 per unique data-svc on card root
      const seen = {};
      document.querySelectorAll('[data-svc="ppob"], [data-svc="ppob-home"], #products, #home-products').forEach(function (el) {
        if (seen.ppob) return;
        seen.ppob = true;
        placeOneBadge(el, 'ppob', 'PPOB');
      });
      document.querySelectorAll('[data-svc="transfer-home"], #domestic-transfer, #home-transfer').forEach(function (el) {
        if (seen.payment) return;
        seen.payment = true;
        placeOneBadge(el, 'payment', 'Transfer');
      });
    } finally {
      applying = false;
    }
  }

  window.BdServiceStage = {
    apply: applyAll,
    fetch: fetchStage,
    badgeHtml: badgeHtml,
    clear: clearBadges
  };

  function boot() {
    applyAll();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
