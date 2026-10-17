// 📨 निमंत्रण — WhatsApp पर 10-10 के बैच में निमंत्रण भेजने की स्क्रीन.
// यह पूरी तरह READ-ONLY है: voters का सिर्फ़ नाम/नंबर पढ़ता है, database में कुछ भी नहीं लिखता.
// "भेजा गया" का निशान सिर्फ़ इसी फ़ोन के browser में रहता है (localStorage).
// भेजना volunteer खुद करता है (WhatsApp खुलता है, Send दबाना होता है) — कोई automation नहीं,
// इसलिए WhatsApp नंबर बैन होने का जोखिम नहीं.
(() => {
  const BATCH = 10;
  const root = document.getElementById('invite-root');
  const tabBtn = document.getElementById('invite-tab-btn');
  const K_TEXT = 'invite-text-v1', K_IMG = 'invite-img-v1', K_SENT = 'invite-sent-v1';
  const DEFAULT_TEXT =
    'नमस्कार, लोर्डियाँ ग्राम पंचायत सरपंच चुनाव अभियान के उद्घाटन समारोह में आपको सादर निमंत्रण है ।\n' +
    '[यहाँ दिनांक, समय व स्थान लिखें]\n' +
    'आपकी उपस्थिति हमारे लिए प्रेरणा होगी ।';

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
  };
  let sent = new Set();
  try { sent = new Set(JSON.parse(store.get(K_SENT, '[]'))); } catch (e) { sent = new Set(); }
  const saveSent = () => store.set(K_SENT, JSON.stringify([...sent]));

  let text = store.get(K_TEXT, DEFAULT_TEXT);
  let img = store.get(K_IMG, '');
  let ward = '';
  let batch = []; // मौजूदा 10 recipients

  function injectStyle() {
    if (document.getElementById('invite-style')) return;
    const st = document.createElement('style');
    st.id = 'invite-style';
    st.textContent = `
      .inv-field { width: 100%; padding: 10px 12px; border: 1px solid #DEDAD1; border-radius: 8px; font: inherit; background: #fff; }
      textarea.inv-field { min-height: 130px; resize: vertical; line-height: 1.5; }
      .inv-label { display: block; margin: 12px 0 6px; font-size: .85rem; color: #6B6F76; font-weight: 600; }
      .inv-bar { display: flex; gap: 8px; align-items: center; margin-top: 12px; }
      .inv-bar select { flex: 1; }
      .inv-progress { margin: 14px 0 4px; font-weight: 600; }
      .inv-row { display: flex; align-items: center; gap: 10px; padding: 10px 12px; margin-top: 8px;
        background: #fff; border: 1px solid #DEDAD1; border-radius: 10px; }
      .inv-row.sent { background: #EEF7F0; border-color: #BFE0C8; }
      .inv-info { flex: 1; min-width: 0; }
      .inv-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .inv-meta { font-size: .8rem; color: #6B6F76; }
      .inv-send { flex: none; min-width: 100px; text-align: center; text-decoration: none; background: #25D366;
        color: #fff; padding: 11px 12px; border-radius: 8px; font-weight: 600; }
      .inv-row.sent .inv-send { background: #6B6F76; }
      .inv-warn { color: #B3423C; min-height: 1.2em; margin: 8px 0 0; font-size: .88rem; }
    `;
    document.head.appendChild(st);
  }

  // सभी अलग-अलग नंबर (एक नंबर एक ही बार), ward → serial क्रम में. हटाए गए (मृत/शिफ़्ट/डुप्लिकेट) voters शामिल नहीं.
  function recipients() {
    const seen = new Set();
    const out = [];
    allVoters
      .filter((v) => !v.deletion_status && (!ward || String(wardNumbers[v.ward_id]) === ward))
      .sort(bySerial)
      .forEach((v) => {
        const num = normPhone(v.phone);
        if (!num || seen.has(num)) return;
        seen.add(num);
        out.push({ num, name: v.name || '—', ward: wardNumbers[v.ward_id], serial: v.serial_number });
      });
    return out;
  }

  function pickBatch() {
    batch = recipients().filter((r) => !sent.has(r.num)).slice(0, BATCH);
  }

  function messageProblem() {
    const t = text.trim();
    if (!t) return 'पहले निमंत्रण का संदेश लिखें।';
    if (t.includes('[यहाँ')) return 'संदेश में [यहाँ ...] वाली जगह पर दिनांक, समय व स्थान भरें।';
    if (img.trim() && !/^https?:\/\//i.test(img.trim())) return 'फोटो का लिंक http:// या https:// से शुरू होना चाहिए।';
    return '';
  }

  const fullMessage = () => text.trim() + (img.trim() ? `\n\n${img.trim()}` : '');

  function render() {
    injectStyle();
    const wrap = h('div');
    wrap.append(h('h2', 'panel-title', '📨 निमंत्रण भेजें'),
      h('p', 'muted', `10-10 के बैच में: हर नाम के आगे 💬 दबाएँ → WhatsApp खुलेगा → Send दबाकर वापस आएँ। भेजे गए का निशान इसी फ़ोन में रहता है।`));

    if (!allVoters.length) {
      const b = h('button', 'visit-btn', '↻ डेटा लोड हो रहा है — फिर देखें');
      b.type = 'button';
      b.addEventListener('click', () => { pickBatch(); render(); });
      wrap.append(b);
      root.replaceChildren(wrap);
      return;
    }

    // संदेश + फोटो का लिंक
    wrap.append(h('label', 'inv-label', 'निमंत्रण का संदेश'));
    const ta = h('textarea', 'inv-field');
    ta.value = text;
    ta.addEventListener('input', () => { text = ta.value; store.set(K_TEXT, text); warn.textContent = ''; });
    wrap.append(ta);

    wrap.append(h('label', 'inv-label', 'निमंत्रण फोटो का लिंक (संदेश के नीचे जुड़ेगा, खाली छोड़ सकते हैं)'));
    const im = h('input', 'inv-field');
    im.type = 'url';
    im.placeholder = 'https://...';
    im.value = img;
    im.addEventListener('input', () => { img = im.value; store.set(K_IMG, img); warn.textContent = ''; });
    wrap.append(im);

    // ward चुनें + रीसेट
    const bar = h('div', 'inv-bar');
    const sel = h('select', 'inv-field');
    sel.append(new Option('सभी वार्ड', ''));
    [...new Set(Object.values(wardNumbers).map(String))]
      .sort((a, b) => Number(a) - Number(b))
      .forEach((w) => sel.append(new Option(`वार्ड ${w}`, w)));
    sel.value = ward;
    sel.addEventListener('change', () => { ward = sel.value; pickBatch(); render(); });
    const reset = h('button', 'ghost', 'निशान रीसेट');
    reset.type = 'button';
    reset.style.cssText = 'color:#B3423C;border-color:#B3423C;flex:none';
    reset.addEventListener('click', () => {
      if (!sent.size || !confirm('"भेजा गया" के सारे निशान मिटाएँ? (सिर्फ़ इसी फ़ोन के निशान मिटेंगे, voters का डेटा नहीं)')) return;
      sent = new Set(); saveSent(); pickBatch(); render();
    });
    bar.append(sel, reset);
    wrap.append(bar);

    const warn = h('p', 'inv-warn');
    const all = recipients();
    const done = all.filter((r) => sent.has(r.num)).length;
    wrap.append(h('p', 'inv-progress', `भेजे गए: ${done} / ${all.length} नंबर · बाकी ${all.length - done}`));

    batch.forEach((r) => {
      const row = h('div', `inv-row${sent.has(r.num) ? ' sent' : ''}`);
      const info = h('div', 'inv-info');
      info.append(h('div', 'inv-name', r.name), h('div', 'inv-meta', `वार्ड ${r.ward} · क्र. ${r.serial ?? '—'} · ${r.num}`));
      const a = h('a', 'inv-send', sent.has(r.num) ? '✓ भेजा गया' : '💬 भेजें');
      a.href = `https://wa.me/91${r.num}?text=${encodeURIComponent(fullMessage())}`;
      a.target = '_blank';
      a.rel = 'noopener';
      a.addEventListener('click', (e) => {
        const p = messageProblem();
        if (p) { e.preventDefault(); warn.textContent = p; return; }
        a.href = `https://wa.me/91${r.num}?text=${encodeURIComponent(fullMessage())}`; // ताज़ा संदेश
        sent.add(r.num); saveSent();
        row.classList.add('sent');
        a.textContent = '✓ भेजा गया';
        updateProgress();
      });
      row.append(info, a);
      wrap.append(row);
    });

    function updateProgress() {
      const d = all.filter((r) => sent.has(r.num)).length;
      const el = wrap.querySelector('.inv-progress');
      if (el) el.textContent = `भेजे गए: ${d} / ${all.length} नंबर · बाकी ${all.length - d}`;
    }

    wrap.append(warn);
    if (!all.length) {
      wrap.append(h('p', 'list-hint', 'इस चयन में कोई नंबर नहीं मिला।'));
    } else if (done === all.length) {
      wrap.append(h('p', 'list-hint', '✅ सभी नंबरों पर निमंत्रण भेजा जा चुका है।'));
    } else {
      const next = h('button', 'visit-btn', `➡ अगले ${Math.min(BATCH, all.length - done)} लोग`);
      next.type = 'button';
      next.style.marginTop = '12px';
      next.addEventListener('click', () => { pickBatch(); render(); window.scrollTo(0, 0); });
      wrap.append(next);
    }
    root.replaceChildren(wrap);
  }

  tabBtn.addEventListener('click', () => {
    if (allVoters.length && (!batch.length || batch.every((r) => sent.has(r.num)))) pickBatch();
    render();
  });
  document.addEventListener('user-gone', () => { batch = []; root.replaceChildren(); });
})();
