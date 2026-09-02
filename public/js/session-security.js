/**
 * Captcha helpers, PIN modal, idle session (3 min / warning at 2 min)
 */
(function (global) {
  const IDLE_MS = 3 * 60 * 1000;
  const WARN_AT_MS = 2 * 60 * 1000; // show countdown for last 1 min
  let lastActivity = Date.now();
  let warnShown = false;
  let countdownTimer = null;
  let idleTimer = null;
  let onLogout = null;
  let overlayEl = null;

  function markActivity() {
    if (warnShown) return; // blocked during countdown
    lastActivity = Date.now();
  }

  async function loadCaptcha(containerId) {
    const box = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
    if (!box) return null;
    try {
      const r = await fetch('/api/captcha');
      const j = await r.json();
      if (!j.success) throw new Error('captcha fail');
      const d = j.data;
      box.innerHTML =
        '<label style="font-size:.8rem;font-weight:600;display:block;margin-bottom:4px">Captcha <span style="color:#e11d48">*</span></label>' +
        '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
        '<div style="font-family:ui-monospace,monospace;font-weight:700;letter-spacing:1px;padding:8px 12px;border-radius:10px;background:linear-gradient(135deg,#0f172a,#1e1b4b);color:#67e8f9;border:1px solid rgba(103,232,249,.3);user-select:none">' +
        (d.display || d.question) + '</div>' +
        '<input type="text" name="captcha_answer" class="captcha-answer-input" required placeholder="Hasil" inputmode="numeric" autocomplete="off" style="width:100px;padding:8px 10px;border-radius:10px;border:1.5px solid #e2e8f0" />' +
        '<input type="hidden" name="captcha_id" class="captcha-id-input" value="' + d.captcha_id + '" />' +
        '<button type="button" class="btn btn-outline btn-sm captcha-reload-btn" title="Muat ulang">↻</button></div>';
      box.querySelector('.captcha-reload-btn')?.addEventListener('click', (ev) => { ev.preventDefault(); loadCaptcha(box); });
      return d;
    } catch (e) {
      box.innerHTML = '<p style="color:#e11d48;font-size:.85rem">Gagal muat captcha</p>';
      return null;
    }
  }

  function getCaptchaPayload(form) {
    const root = form || document;
    return {
      captcha_id: root.querySelector('.captcha-id-input, [name="captcha_id"]')?.value,
      captcha_answer: root.querySelector('.captcha-answer-input, [name="captcha_answer"]')?.value
    };
  }

  function ensurePinModal() {
    let d = document.getElementById('pin-modal-root');
    if (d) return;
    d = document.createElement('div');
    d.id = 'pin-modal-root';
    d.setAttribute('role', 'dialog');
    d.style.cssText = 'display:none;position:fixed;inset:0;z-index:2147483000;background:rgba(15,23,42,.65);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);align-items:center;justify-content:center;padding:16px';
    d.innerHTML =
      '<div style="background:linear-gradient(160deg,#ffffff 0%,#f0f9ff 100%);border-radius:20px;padding:28px 24px;max-width:360px;width:100%;box-shadow:0 25px 60px rgba(15,23,42,.35),0 0 0 1px rgba(99,102,241,.12);text-align:center">' +
      '<div style="width:56px;height:56px;margin:0 auto 14px;border-radius:16px;background:linear-gradient(135deg,#06b6d4,#6366f1);display:flex;align-items:center;justify-content:center;box-shadow:0 8px 20px rgba(99,102,241,.4)">' +
      '<span style="font-size:1.6rem;filter:grayscale(0)">🔐</span></div>' +
      '<h3 style="margin:0 0 6px;font-size:1.15rem;font-weight:800;background:linear-gradient(90deg,#0ea5e9,#6366f1);-webkit-background-clip:text;background-clip:text;color:transparent" id="pin-modal-title">PIN Transaksi</h3>' +
      '<p style="margin:0 0 18px;font-size:.85rem;color:#64748b;line-height:1.4" id="pin-modal-desc">Masukkan PIN 6 digit</p>' +
      '<div id="pin-dots" style="display:flex;gap:8px;justify-content:center;margin-bottom:14px">' +
      [0,1,2,3,4,5].map(function(i){return '<span data-dot="'+i+'" style="width:14px;height:14px;border-radius:50%;background:#e2e8f0;border:2px solid #cbd5e1;transition:all .15s"></span>';}).join('') +
      '</div>' +
      '<input id="pin-modal-input" type="tel" inputmode="numeric" maxlength="6" autocomplete="one-time-code" ' +
      'style="width:1px;height:1px;opacity:0.01;position:fixed;left:50%;top:40%;caret-color:transparent" />' +
      '<div id="pin-boxes" style="display:flex;gap:8px;justify-content:center;margin-bottom:16px">' +
      [0,1,2,3,4,5].map(function(i){return '<div data-box="'+i+'" style="width:42px;height:48px;border-radius:12px;border:2px solid #e2e8f0;background:#fff;display:flex;align-items:center;justify-content:center;font-size:1.35rem;font-weight:700;color:#0f172a;box-shadow:inset 0 1px 2px rgba(0,0,0,.04)"></div>';}).join('') +
      '</div>' +
      '<div id="pin-modal-err" style="color:#e11d48;font-size:.8rem;min-height:18px;margin-bottom:10px"></div>' +
      '<div style="display:flex;gap:10px;justify-content:center">' +
      '<button type="button" id="pin-modal-cancel" style="flex:1;padding:12px;border-radius:12px;border:1.5px solid #e2e8f0;background:#fff;font-weight:600;cursor:pointer;color:#475569">Batal</button>' +
      '<button type="button" id="pin-modal-ok" style="flex:1;padding:12px;border-radius:12px;border:none;background:linear-gradient(135deg,#06b6d4,#3b82f6 50%,#8b5cf6);color:#fff;font-weight:700;cursor:pointer;box-shadow:0 6px 18px rgba(59,130,246,.35)">Konfirmasi</button></div>' +
      '<p style="margin:14px 0 0;font-size:.72rem;color:#94a3b8">Keamanan transaksi bdPay</p></div>';
    document.body.appendChild(d);
    // keypad focus: click boxes focus hidden input
    d.addEventListener('click', function(ev) {
      if (ev.target.closest('#pin-boxes') || ev.target.closest('#pin-dots')) {
        document.getElementById('pin-modal-input')?.focus();
      }
    });
  }

  function syncPinBoxes(v) {
    const s = String(v || '').replace(/\D/g, '').slice(0, 6);
    for (let i = 0; i < 6; i++) {
      const box = document.querySelector('#pin-boxes [data-box="'+i+'"]');
      const dot = document.querySelector('#pin-dots [data-dot="'+i+'"]');
      if (box) {
        box.textContent = s[i] ? '•' : '';
        box.style.borderColor = s[i] ? '#6366f1' : '#e2e8f0';
        box.style.boxShadow = s[i] ? '0 0 0 3px rgba(99,102,241,.2)' : 'inset 0 1px 2px rgba(0,0,0,.04)';
      }
      if (dot) {
        dot.style.background = s[i] ? 'linear-gradient(135deg,#06b6d4,#6366f1)' : '#e2e8f0';
        dot.style.borderColor = s[i] ? '#6366f1' : '#cbd5e1';
      }
    }
  }

  function requestPin(opts) {
    ensurePinModal();
    const root = document.getElementById('pin-modal-root');
    const title = document.getElementById('pin-modal-title');
    const desc = document.getElementById('pin-modal-desc');
    const input = document.getElementById('pin-modal-input');
    const err = document.getElementById('pin-modal-err');
    title.textContent = opts?.title || 'PIN Transaksi';
    desc.textContent = opts?.desc || 'Masukkan PIN 6 digit untuk melanjutkan';
    input.value = '';
    err.textContent = '';
    syncPinBoxes('');
    root.style.display = 'flex';
    // move to end of body so always on top
    document.body.appendChild(root);
    setTimeout(function() { try { input.focus(); } catch(_){} }, 80);
    return new Promise(function(resolve) {
      const done = function(val) {
        root.style.display = 'none';
        input.oninput = null;
        input.onkeydown = null;
        document.getElementById('pin-modal-ok').onclick = null;
        document.getElementById('pin-modal-cancel').onclick = null;
        resolve(val);
      };
      input.oninput = function() {
        input.value = input.value.replace(/\D/g, '').slice(0, 6);
        syncPinBoxes(input.value);
        err.textContent = '';
        if (input.value.length === 6) {
          // auto confirm optional - keep manual for safety
        }
      };
      document.getElementById('pin-modal-cancel').onclick = function() { done(null); };
      document.getElementById('pin-modal-ok').onclick = function() {
        const v = String(input.value || '').trim();
        if (!/^\d{6}$/.test(v)) {
          err.textContent = 'PIN harus 6 digit angka';
          input.focus();
          return;
        }
        done(v);
      };
      input.onkeydown = function(e) {
        if (e.key === 'Enter') document.getElementById('pin-modal-ok').click();
        if (e.key === 'Escape') done(null);
      };
    });
  }

  function showIdleOverlay(secondsLeft, onExtend, onExit) {
    if (warnShown && overlayEl) return; // already counting
    if (overlayEl) overlayEl.remove();
    warnShown = true;
    document.body.classList.add('session-blur');
    if (!document.getElementById('session-blur-style')) {
      const st = document.createElement('style');
      st.id = 'session-blur-style';
      st.textContent = 'body.session-blur > *:not(#idle-session-box){filter:blur(6px);pointer-events:none!important;user-select:none}' +
        '#idle-session-box{filter:none!important;pointer-events:auto!important}';
      document.head.appendChild(st);
    }
    overlayEl = document.createElement('div');
    overlayEl.id = 'idle-session-box';
    overlayEl.style.cssText = 'position:fixed;inset:0;z-index:20000;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,.35)';
    let left = secondsLeft;
    const fmt = (s) => {
      const m = Math.floor(s / 60);
      const sec = s % 60;
      return String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
    };
    overlayEl.style.background = 'rgba(2,6,23,.72)';
    overlayEl.innerHTML = '<div style="background:linear-gradient(160deg,#0f172a,#1e1b4b);border-radius:20px;padding:28px 24px;max-width:360px;width:92%;text-align:center;box-shadow:0 0 0 1px rgba(250,204,21,.35),0 24px 60px rgba(0,0,0,.5);position:relative;overflow:hidden">' +
      '<div style="position:absolute;inset:-2px;border-radius:22px;padding:2px;background:conic-gradient(from var(--gold-angle,0deg),#fbbf24,#f59e0b,#fde68a,#fbbf24);-webkit-mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);-webkit-mask-composite:xor;mask-composite:exclude;animation:goldSpin 3s linear infinite;pointer-events:none"></div>' +
      '<style>@keyframes goldSpin{to{--gold-angle:360deg}}@property --gold-angle{syntax:"<angle>";inherits:false;initial-value:0deg}</style>' +
      '<div style="font-size:.8rem;color:#94a3b8;margin-bottom:6px;letter-spacing:.08em;text-transform:uppercase">Sesi akan berakhir</div>' +
      '<div id="idle-count" style="font-size:2.4rem;font-weight:800;letter-spacing:3px;font-family:ui-monospace,monospace;background:linear-gradient(90deg,#fbbf24,#fde68a);-webkit-background-clip:text;background-clip:text;color:transparent">' + fmt(left) + '</div>' +
      '<p style="font-size:.85rem;color:#94a3b8;margin:12px 0 18px">Tidak ada aktivitas. Tambah 3 menit atau keluar.</p>' +
      '<div style="display:flex;gap:10px;justify-content:center;position:relative;z-index:1">' +
      '<button type="button" id="idle-extend" class="btn-glow-gold" style="border-radius:999px;padding:12px 20px;border:none;background:linear-gradient(135deg,#fbbf24,#f59e0b);color:#0f172a;font-weight:700;cursor:pointer">Tambah Waktu</button>' +
      '<button type="button" id="idle-exit" style="border-radius:999px;padding:12px 20px;border:1px solid #475569;background:transparent;color:#e2e8f0;font-weight:600;cursor:pointer">Keluar</button></div></div>';
    document.body.appendChild(overlayEl);
    const tick = () => {
      left -= 1;
      const el = document.getElementById('idle-count');
      if (el) el.textContent = fmt(Math.max(0, left));
      if (left <= 0) {
        clearInterval(countdownTimer);
        hideIdleOverlay();
        warnShown = false;
        try { if (overlayEl) { overlayEl.remove(); overlayEl = null; } } catch (_) {}
        if (typeof onExit === 'function') onExit();
      }
    };
    clearInterval(countdownTimer);
    countdownTimer = setInterval(tick, 1000);
    document.getElementById('idle-extend').onclick = () => {
      clearInterval(countdownTimer);
      hideIdleOverlay();
      lastActivity = Date.now();
      if (typeof onExtend === 'function') onExtend();
    };
    document.getElementById('idle-exit').onclick = () => {
      clearInterval(countdownTimer);
      hideIdleOverlay();
      if (typeof onExit === 'function') onExit();
    };
  }

  function hideIdleOverlay() {
    warnShown = false;
    document.body.classList.remove('session-blur');
    if (overlayEl) { overlayEl.remove(); overlayEl = null; }
  }

  let activityBound = false;
  function forceLogout() {
    clearInterval(idleTimer);
    clearInterval(countdownTimer);
    hideIdleOverlay();
    const fn = onLogout;
    onLogout = () => {};
    try { if (typeof fn === 'function') fn(); } catch (e) { console.warn('idle logout', e); }
  }

  function startIdleWatch(opts) {
    onLogout = opts?.onLogout || (() => {});
    lastActivity = Date.now();
    warnShown = false;
    if (!activityBound) {
      activityBound = true;
      ['click', 'keydown', 'mousemove', 'touchstart', 'scroll', 'pointerdown'].forEach(ev => {
        document.addEventListener(ev, markActivity, { passive: true });
      });
    }
    clearInterval(idleTimer);
    idleTimer = setInterval(() => {
      if (warnShown) return; // countdown box handles final logout
      const idle = Date.now() - lastActivity;
      if (idle >= IDLE_MS) {
        forceLogout();
        return;
      }
      if (idle >= WARN_AT_MS) {
        const remain = Math.max(1, Math.ceil((IDLE_MS - idle) / 1000));
        showIdleOverlay(remain, () => { lastActivity = Date.now(); }, () => forceLogout());
      }
    }, 1000);
  }

  function stopIdleWatch() {
    clearInterval(idleTimer);
    clearInterval(countdownTimer);
    hideIdleOverlay();
    onLogout = () => {};
  }

  global.BdSecurity = {
    loadCaptcha,
    getCaptchaPayload,
    requestPin,
    startIdleWatch,
    stopIdleWatch,
    markActivity
  };
})(window);
