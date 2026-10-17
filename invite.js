// 📨 निमंत्रण — WhatsApp पर 10-10 के बैच में निमंत्रण, सभी volunteers के लिए एकीकृत.
// कोई भी volunteer "भेजें" दबाता है तो वह नंबर सभी के फ़ोन पर तुरंत "✓ <नाम> ने भेजा" दिखता है.
// इसके लिए सिर्फ़ एक नई, अलग टेबल `invite_sends` इस्तेमाल होती है — voters/visits आदि की
// किसी भी मौजूदा टेबल में कुछ नहीं लिखा या बदला जाता. भेजना volunteer खुद करता है (Send वही दबाता है).
(() => {
  // ===== यहाँ बदलें (सबके लिए एक जैसा) =====
  const CAMPAIGN = 'invite-1'; // नया दौर शुरू करना हो तो 'invite-2' कर दें — सब निशान नए सिरे से शुरू होंगे
  const MESSAGE = `🙏🌺 जय श्री माँ लटियाल 🌺🙏

💐 समस्त ग्रामवासियों को सादर आमंत्रण 💐

आप सभी ग्रामवासियों के आशीर्वाद, विश्वास एवं सहयोग से मैं भीमराज नटवरलाल पुरोहित, सरपंच पद प्रत्याशी, लोडियाँ, अपने चुनाव कार्यालय का शुभारंभ करने जा रहा हूँ।

इस शुभ अवसर पर आप सभी भाई-बहनों, बुजुर्गों, युवाओं एवं मातृशक्ति से विनम्र निवेदन है कि पधारकर मुझे अपना स्नेह, आशीर्वाद एवं मार्गदर्शन प्रदान करें।

📅 दिनांक: 17 अक्टूबर 2026, शनिवार ⏰ समय: दोपहर 12 बजकर 15 मिनट 📍 स्थान: चुनाव कार्यालय, लोडियाँ

आपकी उपस्थिति मेरे लिए सम्मान, शक्ति और प्रेरणा का स्रोत होगी। यदि किसी कारणवश आपको व्यक्तिगत निमंत्रण नहीं मिल पाया हो, तो कृपया इसे ही मेरा व्यक्तिगत निमंत्रण स्वीकार कर अपनी गरिमामयी उपस्थिति अवश्य प्रदान करें।

🌿 आपका साथ, मेरा संकल्प — मिलकर बनाएँ विकासशील लोडियाँ। 🌿

🙏 आपका अपना भीमराज नटवरलाल पुरोहित सरपंच पद प्रत्याशी, लोडियाँ

💐 आप सभी सादर आमंत्रित हैं। जय श्री माँ लटियाल! 💐`;
  const IMAGE_URL = ''; // निमंत्रण फोटो का पब्लिक लिंक (https://...), खाली छोड़ सकते हैं
  // ==========================================

  const BATCH = 10;
  const root = document.getElementById('invite-root');
  const tabBtn = document.getElementById('invite-tab-btn');
  const tabPanel = document.getElementById('invite-tab');

  let sends = new Map(); // phone -> { sent_by, sent_at }  (सभी volunteers के भेजे हुए)
  let ward = '';
  let batch = [];
  let loadError = '';
  let flash = ''; // अगली render पर दिखने वाला संदेश
  let channel = null;

  function injectStyle() {
    if (document.getElementById('invite-style')) return;
    const st = document.createElement('style');
    st.id = 'invite-style';
    st.textContent = `
      .inv-msg { white-space: pre-wrap; background: #fff; border: 1px solid #DEDAD1; border-radius: 8px;
        padding: 10px 12px; line-height: 1.5; font-size: .92rem; }
      .inv-bar { display: flex; gap: 8px; align-items: center; margin-top: 12px; }
      .inv-sel { flex: 1; padding: 10px 12px; border: 1px solid #DEDAD1; border-radius: 8px; font: inherit; background: #fff; }
      .inv-progress { margin: 14px 0 2px; font-weight: 600; }
      .inv-by { margin: 0 0 4px; font-size: .82rem; color: #6B6F76; }
      .inv-row { display: flex; align-items: center; gap: 10px; padding: 10px 12px; margin-top: 8px;
        background: #fff; border: 1px solid #DEDAD1; border-radius: 10px; }
      .inv-row.sent { background: #EEF7F0; border-color: #BFE0C8; }
      .inv-info { flex: 1; min-width: 0; }
      .inv-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .inv-meta { font-size: .8rem; color: #6B6F76; }
      .inv-sentby { font-size: .82rem; color: #2E7D4F; font-weight: 600; }
      .inv-send { flex: none; min-width: 100px; text-align: center; text-decoration: none; background: #25D366;
        color: #fff; padding: 11px 12px; border-radius: 8px; font-weight: 600; }
      .inv-row.sent .inv-send { background: #6B6F76; }
      .inv-legacy { background: #FFF8E6; border: 1px solid #E8D49A; border-radius: 10px; padding: 10px 12px; margin-top: 12px; font-size: .9rem; }
      .inv-warn { color: #B3423C; min-height: 1.2em; margin: 8px 0 0; font-size: .88rem; }
    `;
    document.head.appendChild(st);
  }

  const me = () => (window.appUser ? window.appUser.id : null);
  const who = (id) => (id === me() ? 'आपने' : `${names[id] || 'किसी volunteer'} ने`);
  const when = (ts) => new Date(ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const visible = () => tabPanel && !tabPanel.hidden;

  async function loadSends() {
    const { data, error } = await sb.from('invite_sends').select('phone, sent_by, sent_at').eq('campaign', CAMPAIGN).limit(5000);
    if (error) { loadError = error.message || String(error); return; }
    loadError = '';
    sends = new Map((data || []).map((r) => [r.phone, r]));
  }

  // दूसरे volunteers के भेजते ही यहाँ तुरंत दिख जाए (Supabase Realtime).
  function subscribe() {
    if (channel) return;
    channel = sb.channel('invite-sends-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invite_sends' }, (p) => {
        const row = p.eventType === 'DELETE' ? p.old : p.new;
        if (!row || !row.phone || (row.campaign && row.campaign !== CAMPAIGN)) return;
        if (p.eventType === 'DELETE') sends.delete(row.phone);
        else sends.set(row.phone, { sent_by: row.sent_by, sent_at: row.sent_at });
        if (visible()) render();
      })
      .subscribe();
  }

  // सभी अलग-अलग नंबर (एक नंबर एक ही बार), ward → serial क्रम में. मृत/शिफ़्ट/डुप्लिकेट voters शामिल नहीं.
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

  // पुराने संस्करण में इस फ़ोन पर लगे "भेजा गया" निशान (सिर्फ़ इसी फ़ोन में थे, बाकी को नहीं दिखते थे).
  const LEGACY_KEY = 'invite-sent-v1';
  function legacyNumbers() {
    try {
      const a = JSON.parse(localStorage.getItem(LEGACY_KEY) || '[]');
      return Array.isArray(a) ? [...new Set(a.map(String))].filter((n) => /^[6-9]\d{9}$/.test(n)) : [];
    } catch (e) { return []; }
  }

  const pickBatch = () => { batch = recipients().filter((r) => !sends.has(r.num)).slice(0, BATCH); };

  function messageProblem() {
    if (!MESSAGE.trim()) return 'invite.js में MESSAGE खाली है।';
    if (MESSAGE.includes('[यहाँ')) return 'invite.js में MESSAGE के अंदर [यहाँ ...] वाली जगह पर दिनांक, समय व स्थान भरें।';
    return '';
  }
  const fullMessage = () => MESSAGE.trim() + (IMAGE_URL.trim() ? `\n\n${IMAGE_URL.trim()}` : '');
  const waLink = (num) => `https://wa.me/91${num}?text=${encodeURIComponent(fullMessage())}`;

  function render() {
    injectStyle();
    const wrap = h('div');
    wrap.append(h('h2', 'panel-title', '📨 निमंत्रण भेजें'),
      h('p', 'muted', '10-10 के बैच में: 💬 दबाएँ → WhatsApp खुलेगा → Send दबाकर वापस आएँ। कोई भी भेजे, सबको दिखेगा कि किसने भेजा।'));
    const warn = h('p', 'inv-warn', flash);
    flash = '';

    if (loadError) {
      wrap.append(h('p', 'inv-warn', `साझा सूची लोड नहीं हुई: ${loadError} (क्या Supabase में invite_sends वाली SQL चलाई गई है?)`));
    }
    if (!allVoters.length) {
      const b = h('button', 'visit-btn', '↻ डेटा लोड हो रहा है — फिर देखें');
      b.type = 'button';
      b.addEventListener('click', async () => { await loadSends(); pickBatch(); render(); });
      wrap.append(b);
      root.replaceChildren(wrap);
      return;
    }

    wrap.append(h('div', 'inv-msg', fullMessage()));
    const prob = messageProblem();
    if (prob) wrap.append(h('p', 'inv-warn', prob));

    const legacy = legacyNumbers();
    if (legacy.length) {
      const toAdd = legacy.filter((n) => !sends.has(n));
      const box = h('div', 'inv-legacy');
      box.append(h('div', null, toAdd.length
        ? `इस फ़ोन पर पहले भेजे गए ${legacy.length} नंबरों के निशान मिले, जो अभी साझा सूची में नहीं हैं (${toAdd.length})। इन्हें जोड़ दें ताकि बाकी volunteers को भी दिखें और दोबारा न भेजे जाएँ।`
        : `इस फ़ोन के पुराने ${legacy.length} निशान पहले से साझा सूची में हैं।`));
      const mb = h('button', 'visit-btn', toAdd.length ? `✔ साझा सूची में जोड़ें (${toAdd.length})` : 'ठीक है, पुराने निशान हटाएँ');
      mb.type = 'button';
      mb.style.marginTop = '8px';
      mb.addEventListener('click', async () => {
        mb.disabled = true;
        if (toAdd.length) {
          const { error } = await sb.from('invite_sends')
            .upsert(toAdd.map((n) => ({ campaign: CAMPAIGN, phone: n })), { onConflict: 'campaign,phone', ignoreDuplicates: true });
          if (error) { flash = `जोड़ा नहीं जा सका: ${error.message}`; render(); return; }
        }
        try { localStorage.removeItem(LEGACY_KEY); } catch (e) { /* ignore */ }
        await loadSends();
        flash = toAdd.length ? `✓ ${toAdd.length} नंबर साझा सूची में जुड़ गए।` : '';
        pickBatch();
        render();
      });
      box.append(mb);
      wrap.append(box);
    }

    const bar = h('div', 'inv-bar');
    const sel = h('select', 'inv-sel');
    sel.append(new Option('सभी वार्ड', ''));
    [...new Set(Object.values(wardNumbers).map(String))]
      .sort((a, b) => Number(a) - Number(b))
      .forEach((w) => sel.append(new Option(`वार्ड ${w}`, w)));
    sel.value = ward;
    sel.addEventListener('change', () => { ward = sel.value; pickBatch(); render(); });
    const refresh = h('button', 'ghost', '↻ ताज़ा करें');
    refresh.type = 'button';
    refresh.style.cssText = 'color:#1E2A4A;border-color:#1E2A4A;flex:none;min-height:40px';
    refresh.addEventListener('click', async () => { await loadSends(); render(); });
    bar.append(sel, refresh);
    wrap.append(bar);

    const all = recipients();
    const done = all.filter((r) => sends.has(r.num)).length;
    wrap.append(h('p', 'inv-progress', `भेजे गए: ${done} / ${all.length} नंबर · बाकी ${all.length - done}`));
    const perUser = {};
    all.forEach((r) => { const s = sends.get(r.num); if (s) perUser[s.sent_by] = (perUser[s.sent_by] || 0) + 1; });
    const summary = Object.entries(perUser).sort((a, b) => b[1] - a[1])
      .map(([id, n]) => `${id === me() ? 'आप' : (names[id] || 'कोई volunteer')} ${n}`).join(' · ');
    if (summary) wrap.append(h('p', 'inv-by', summary));

    batch.forEach((r) => {
      const s = sends.get(r.num);
      const row = h('div', `inv-row${s ? ' sent' : ''}`);
      const info = h('div', 'inv-info');
      info.append(h('div', 'inv-name', r.name), h('div', 'inv-meta', `वार्ड ${r.ward} · क्र. ${r.serial ?? '—'} · ${r.num}`));
      if (s) {
        info.append(h('div', 'inv-sentby', `✓ ${who(s.sent_by)} भेजा · ${when(s.sent_at)}`));
        if (s.sent_by === me() || (window.appUser && window.appUser.isAdmin)) {
          const undo = h('button', 'dash-link', '↩ गलती से दबा? वापस लें');
          undo.type = 'button';
          undo.addEventListener('click', async () => {
            if (!confirm('इस नंबर का "भेजा गया" निशान सबके लिए हटाएँ?')) return;
            const { error } = await sb.from('invite_sends').delete().eq('campaign', CAMPAIGN).eq('phone', r.num);
            if (error) warn.textContent = `वापस नहीं हुआ: ${error.message}`;
            else { sends.delete(r.num); render(); }
          });
          info.append(undo);
        }
      }
      const a = h('a', 'inv-send', s ? '✓ भेजा गया' : '💬 भेजें');
      a.href = waLink(r.num);
      a.target = '_blank';
      a.rel = 'noopener';
      a.addEventListener('click', (e) => {
        const p = messageProblem();
        if (p) { e.preventDefault(); warn.textContent = p; return; }
        const ex = sends.get(r.num);
        if (ex) { e.preventDefault(); flash = `यह नंबर ${who(ex.sent_by)} पहले ही भेज दिया है।`; render(); return; }
        // तुरंत निशान लगाएँ, फिर सबके लिए सेव करें
        sends.set(r.num, { sent_by: me(), sent_at: new Date().toISOString() });
        sb.from('invite_sends').insert({ campaign: CAMPAIGN, phone: r.num }).then(async ({ error }) => {
          if (error) {
            sends.delete(r.num);
            await loadSends();
            flash = error.code === '23505'
              ? 'इसी पल किसी और volunteer ने यह नंबर भेज दिया — सूची ताज़ा कर दी गई।'
              : `निशान सेव नहीं हुआ: ${error.message}`;
          }
          render();
        });
      });
      row.append(info, a);
      wrap.append(row);
    });

    wrap.append(warn);
    if (!all.length) {
      wrap.append(h('p', 'list-hint', 'इस चयन में कोई नंबर नहीं मिला।'));
    } else if (done === all.length) {
      wrap.append(h('p', 'list-hint', '✅ सभी नंबरों पर निमंत्रण भेजा जा चुका है।'));
    } else {
      const next = h('button', 'visit-btn', `➡ अगले ${Math.min(BATCH, all.length - done)} लोग`);
      next.type = 'button';
      next.style.marginTop = '12px';
      next.addEventListener('click', async () => { await loadSends(); pickBatch(); render(); window.scrollTo(0, 0); });
      wrap.append(next);
    }
    root.replaceChildren(wrap);
  }

  tabBtn.addEventListener('click', async () => {
    subscribe();
    await loadSends();
    if (allVoters.length && (!batch.length || batch.every((r) => sends.has(r.num)))) pickBatch();
    render();
  });
  document.addEventListener('user-gone', () => {
    if (channel) { sb.removeChannel(channel); channel = null; }
    sends = new Map(); batch = []; loadError = '';
    root.replaceChildren();
  });
})();
