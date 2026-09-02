(function () {
  function speak(text, lang) {
    try {
      if (!window.speechSynthesis) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(String(text));
      u.lang = lang || 'id-ID';
      window.speechSynthesis.speak(u);
    } catch (_) {}
  }

  async function mountAudible(where) {
    try {
      const r = await fetch('/api/public/audible');
      const j = await r.json();
      const a = j.data || {};
      if (a.enabled === false) return;
      if (where === 'landing' && a.show_on_landing === false) return;
      if (where === 'pwa' && a.show_on_pwa === false) return;
      if (where === 'merchant' && a.show_on_merchant === false) return;

      if (document.getElementById('bd-audible-bar')) return;
      const bar = document.createElement('div');
      bar.id = 'bd-audible-bar';
      bar.setAttribute('role', 'region');
      bar.setAttribute('aria-label', 'Audible dan AI Assistance');
      bar.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:9998;max-width:320px;background:linear-gradient(135deg,#0f172a,#1e3a5f);color:#fff;padding:12px 14px;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,.35);font-size:13px;border:1px solid rgba(251,191,36,.4)';
      bar.innerHTML = '<div style="font-weight:700;margin-bottom:6px">♿ Audible & AI Assistance</div>' +
        '<p style="margin:0 0 8px;opacity:.9;line-height:1.4">Panduan suara & bantuan AI untuk aksesibilitas. Ketuk Baca untuk TTS.</p>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
        '<button type="button" id="bd-aud-read" style="flex:1;padding:8px;border:0;border-radius:999px;background:linear-gradient(90deg,#fbbf24,#f59e0b);color:#0f172a;font-weight:700;cursor:pointer">Baca Halaman</button>' +
        '<button type="button" id="bd-aud-ai" style="flex:1;padding:8px;border:0;border-radius:999px;background:#22c55e;color:#052e16;font-weight:700;cursor:pointer">AI Bantu</button>' +
        '<button type="button" id="bd-aud-close" style="padding:8px 10px;border:0;border-radius:999px;background:#334155;color:#fff;cursor:pointer">×</button></div>' +
        '<div id="bd-aud-out" style="margin-top:8px;font-size:12px;opacity:.85;display:none"></div>';
      document.body.appendChild(bar);
      document.getElementById('bd-aud-close').onclick = () => bar.remove();
      document.getElementById('bd-aud-read').onclick = () => {
        const main = document.querySelector('main, .wiz-page, .hero, h1');
        const text = (main && main.innerText) ? main.innerText.slice(0, 800) : document.title;
        speak(text, a.tts_lang || 'id-ID');
      };
      document.getElementById('bd-aud-ai').onclick = async () => {
        const out = document.getElementById('bd-aud-out');
        out.style.display = 'block';
        out.textContent = 'Meminta AI…';
        try {
          const rr = await fetch('/api/ai/assist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ task: 'assistance', prompt: 'Sapa pengguna dan tawarkan bantuan mulai bertransaksi di bdPay. Singkat.' })
          });
          const jj = await rr.json();
          out.textContent = jj.text || jj.message || 'Tidak ada respons';
          if (jj.text) speak(jj.text, a.tts_lang || 'id-ID');
        } catch (e) {
          out.textContent = 'AI tidak tersedia';
        }
      };
    } catch (_) {}
  }

  window.BdAudible = { mount: mountAudible, speak: speak };
  document.addEventListener('DOMContentLoaded', () => {
    const path = location.pathname || '';
    if (path.indexOf('/merchant') === 0) mountAudible('merchant');
    else if (path.indexOf('/admin') === 0) return;
    else if (path === '/' || path.indexOf('/index') === 0) mountAudible('landing');
    else mountAudible('pwa');
  });
})();
