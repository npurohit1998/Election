// 🤝 व्यक्तिगत मुलाकात (v2) — voter / परिवार / group / bulk, और नतीजे के प्रकार.
// "मिला" = सिर्फ़ outcome='met' (व्यक्तिगत रूप से मिले). बाकी नतीजे (घर पर नहीं मिले / बाहर गाँव / फ़ोन पर बात)
// "प्रयास" हैं — ये "बाकी" में ही गिने जाते हैं, पर अलग स्थिति के साथ दिखते हैं.
// सिर्फ़ टेबल `voter_meetings` इस्तेमाल होती है. voters.js / groups.js से: allVoters, wardNumbers, names, h, rowTemplate,
// photoSrc, showDetail, matchesSearch, bySerial, debounce.
(() => {
  const POLL_DAY = '2026-10-24'; // मतदान की तारीख़ (बदलनी हो तो सिर्फ़ यही)
  const PAGE = 50;
  const MAX_SELECT = 500;
  const COLS = 'meeting_id, voter_id, user_id, met_at, note, outcome, scope, batch_id';
  const OUTCOME = {
    met: '✓ व्यक्तिगत रूप से मिले', not_home: '↻ घर पर नहीं मिले',
    away: '✈ बाहर गाँव / शहर में', phone: '📞 सिर्फ़ फ़ोन पर बात हुई',
  };
  const OUTCOME_SHORT = { met: 'मिले', not_home: 'घर पर नहीं मिले', away: 'बाहर गाँव/शहर में', phone: 'फ़ोन पर बात हुई' };

  const root = document.getElementById('meet-root');
  const tabBtn = document.getElementById('meet-tab-btn');
  const tabPanel = document.getElementById('meet-tab');

  let meets = new Map();   // voter_id -> [मुलाकातें/प्रयास, नए पहले]
  let loaded = false;
  let loading = false;
  let loadError = '';
  let built = false;
  let limit = PAGE;
  const f = { q: '', ward: '', loc: '', show: 'pending' };
  let selectMode = false;
  let selected = new Set();
  let wholeHouse = true;
  let lastList = [];
  let rowEls = new Map();
  let statsEl, listEl, countEl, msgEl, qIn, wardSel, locSel, segEl, moreBtn, selBtn, bar, barCount, barMsg, outSel, noteIn, addBtn;

  // ---------- Helpers ----------
  const whenText = (t) => new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const isAdmin = () => !!(window.appUser && window.appUser.isAdmin);
  const visible = () => !document.hidden && !document.getElementById('app-view').hidden && !tabPanel.hidden;
  const activeVoters = () => allVoters.filter((v) => v.is_active);
  const famKey = (v) => `${v.ward_id}|${v.locality || ''}|${v.house_number || ''}`; // groups.js के families() जैसा ही
  const uuid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16); }));
  const canRemove = (m) => !!window.appUser && (isAdmin() || m.user_id === window.appUser.id);

  // 'met' = मिल चुके, 'tried' = प्रयास हुआ पर नहीं मिले, 'none' = कुछ दर्ज नहीं
  function stateOf(v) {
    const l = meets.get(v.voter_id);
    if (!l) return 'none';
    return l.some((m) => m.outcome === 'met') ? 'met' : 'tried';
  }
  // ward → locality → मकान (संख्या के हिसाब से) → serial. PDF में भी यही क्रम है.
  const cmpHouse = (a, b) =>
    (wardNumbers[a.ward_id] - wardNumbers[b.ward_id]) ||
    String(a.locality || '').localeCompare(String(b.locality || '')) ||
    String(a.house_number || '').localeCompare(String(b.house_number || ''), undefined, { numeric: true }) ||
    bySerial(a, b);

  function daysLeft() {
    const t = new Date(`${POLL_DAY}T00:00:00`);
    const n = new Date();
    n.setHours(0, 0, 0, 0);
    return Math.round((t - n) / 86400000);
  }
  function linkBtn(text, onClick) {
    const b = h('button', 'dash-link', text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }
  function outcomeSelect() {
    const s = h('select', 'meet-outcome');
    Object.entries(OUTCOME).forEach(([k, t]) => s.append(new Option(t, k)));
    return s;
  }

  // ---------- Data ----------
  async function loadMeets() {
    if (loading) return;
    loading = true;
    try {
      const rows = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from('voter_meetings').select(COLS).order('meeting_id').range(from, from + 999);
        if (error) throw error;
        rows.push(...data);
        if (data.length < 1000) break;
      }
      const m = new Map();
      rows.forEach((r) => { if (!m.has(r.voter_id)) m.set(r.voter_id, []); m.get(r.voter_id).unshift(r); }); // नए पहले
      meets = m;
      loaded = true;
      loadError = '';
    } catch (e) {
      loadError = e.message || String(e);
    }
    loading = false;
    if (built) paint();
  }
  const ensureLoaded = () => (loaded ? Promise.resolve() : loadMeets());

  function addLocal(rows) {
    rows.forEach((r) => {
      const l = meets.get(r.voter_id) || [];
      l.unshift(r);
      meets.set(r.voter_id, l);
    });
    if (built) paint();
  }

  // कई voters की एक साथ एंट्री (एक ही batch_id). {ok,count,batch} या {error,batch}
  async function recordMany(list, { outcome = 'met', scope = 'individual', note = '' } = {}) {
    const batch = uuid();
    const rows = list.map((v) => {
      const r = { voter_id: v.voter_id, user_id: window.appUser.id, outcome, scope, batch_id: batch };
      if (note) r.note = note;
      return r;
    });
    const saved = [];
    for (let i = 0; i < rows.length; i += 200) {
      const { data, error } = await sb.from('voter_meetings').insert(rows.slice(i, i + 200)).select(COLS);
      if (error) {
        addLocal(saved);
        return { error: `दर्ज नहीं हुआ: ${error.message}${saved.length ? ` (${saved.length} पहले दर्ज हो चुके हैं)` : ''}`, batch };
      }
      saved.push(...data);
    }
    addLocal(saved);
    return { ok: true, count: saved.length, batch };
  }

  async function removeRow(m) {
    const { error } = await sb.from('voter_meetings').delete().eq('meeting_id', m.meeting_id);
    if (error) return error.message;
    const l = (meets.get(m.voter_id) || []).filter((x) => x.meeting_id !== m.meeting_id);
    if (l.length) meets.set(m.voter_id, l); else meets.delete(m.voter_id);
    if (built) paint();
    return '';
  }

  async function undoBatch(batch) {
    const { error } = await sb.from('voter_meetings').delete().eq('batch_id', batch);
    if (error) return error.message;
    await loadMeets(); // सच्ची स्थिति दोबारा पढ़ें
    return '';
  }

  // संदेश + "↶ वापस लें" (पूरे batch के लिए)
  function toast(el, text, batch) {
    el.replaceChildren(document.createTextNode(`${text} `));
    if (!batch) return;
    const b = linkBtn('↶ वापस लें', async () => {
      b.disabled = true;
      el.textContent = 'वापस ले रहे हैं…';
      const err = await undoBatch(batch);
      el.textContent = err ? `वापस नहीं हुआ: ${err}` : 'वापस ले लिया ✓';
    });
    el.append(b);
  }

  // ---------- Filtering ----------
  const okShow = (v, show) => {
    const s = stateOf(v);
    return show === 'all' || (show === 'pending' && s !== 'met') || (show === 'tried' && s === 'tried') || (show === 'met' && s === 'met');
  };
  function filtered(pendingOnly) {
    const show = pendingOnly ? 'pending' : f.show;
    const out = activeVoters().filter((v) =>
      matchesSearch(v, f.q) && (!f.loc || v.locality === f.loc) && (!f.ward || String(v.ward_id) === f.ward) && okShow(v, show));
    if (show === 'met') return out.sort((a, b) => meets.get(b.voter_id)[0].met_at.localeCompare(meets.get(a.voter_id)[0].met_at));
    return out.sort(cmpHouse);
  }

  // ---------- Painting ----------
  function todayCounts() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const per = new Map();
    meets.forEach((l, vid) => l.forEach((m) => {
      if (m.outcome !== 'met' || new Date(m.met_at) < start) return;
      if (!per.has(m.user_id)) per.set(m.user_id, new Set());
      per.get(m.user_id).add(vid);
    }));
    return [...per.entries()].map(([u, s]) => [names[u] || 'Someone', s.size]).sort((a, b) => b[1] - a[1]);
  }

  function paintStats() {
    const act = activeVoters();
    let met = 0, tried = 0;
    act.forEach((v) => { const s = stateOf(v); if (s === 'met') met++; else if (s === 'tried') tried++; });
    const left = act.length - met;
    const d = daysLeft();
    const card = h('div', 'meet-card');
    card.append(h('div', 'meet-big', `${met} / ${act.length}`),
      h('div', 'meet-sub', `voters से व्यक्तिगत मुलाकात हो चुकी (${act.length ? Math.round((met * 1000) / act.length) / 10 : 0}%)`));
    const barEl = h('div', 'meet-bar');
    const fill = h('span');
    fill.style.width = `${act.length ? (met * 100) / act.length : 0}%`;
    barEl.append(fill);
    card.append(barEl);
    let line = `मिलना बाकी: ${left}${tried ? ` (इनमें ${tried} पर प्रयास हो चुका)` : ''}`;
    if (d > 0 && left) line += ` · मतदान में ${d} दिन बाकी — रोज़ लगभग ${Math.ceil(left / d)} से मिलना होगा`;
    else if (d === 0) line += ' · आज मतदान का दिन है';
    card.append(h('div', 'meet-sub', line));
    const today = todayCounts();
    card.append(h('div', 'meet-sub', today.length
      ? `आज: ${today.map(([n, c]) => `${n} ${c}`).join(' · ')}`
      : 'आज अभी कोई मुलाकात दर्ज नहीं हुई।'));

    const byWard = new Map();
    act.forEach((v) => {
      const s = byWard.get(v.ward_id) || { t: 0, m: 0 };
      s.t++;
      if (stateOf(v) === 'met') s.m++;
      byWard.set(v.ward_id, s);
    });
    const tb = h('table', 'dash-table');
    const head = h('tr');
    ['Ward', 'कुल', 'मिले', 'बाकी'].forEach((x) => head.append(h('th', null, x)));
    tb.append(head);
    [...byWard.entries()].sort((a, b) => wardNumbers[a[0]] - wardNumbers[b[0]]).forEach(([id, s]) => {
      const tr = h('tr');
      const td = h('td');
      td.append(linkBtn(`Ward ${wardNumbers[id]} ›`, () => { f.ward = String(id); f.loc = ''; f.show = 'pending'; syncControls(); limit = PAGE; paint(); }));
      tr.append(td, h('td', null, s.t), h('td', null, s.m), h('td', null, s.t - s.m));
      tb.append(tr);
    });
    statsEl.replaceChildren(card, tb);
  }

  function statusLine(v) {
    const l = meets.get(v.voter_id);
    if (!l) return ['अभी तक नहीं मिले', ''];
    if (stateOf(v) === 'met') {
      const m = l.find((x) => x.outcome === 'met');
      const more = l.length > 1 ? ` (+${l.length - 1})` : '';
      return [`✓ ${names[m.user_id] || 'Someone'} · ${whenText(m.met_at)}${more}`, 'done'];
    }
    return [`↻ ${OUTCOME_SHORT[l[0].outcome]} · ${names[l[0].user_id] || 'Someone'} · ${whenText(l[0].met_at)}`, 'tried'];
  }

  function rowNode(v) {
    const node = rowTemplate.content.cloneNode(true);
    const row = node.querySelector('.voter-row');
    const img = node.querySelector('.voter-thumb');
    if (v.photo_url) img.src = photoSrc(v); else img.classList.add('no-photo');
    node.querySelector('.voter-row-name').textContent = v.name || '(name pending)';
    node.querySelector('.voter-row-meta').textContent =
      `Ward ${wardNumbers[v.ward_id] || '?'} · House ${v.house_number || '—'} · ${v.locality || '—'}`;
    const [txt, cls] = statusLine(v);
    node.querySelector('.voter-row-info').append(h('div', `voter-row-meta meet-status ${cls}`, txt));
    rowEls.set(v.voter_id, row);

    if (selectMode) {
      const on = selected.has(v.voter_id);
      row.prepend(h('span', `row-check${on ? ' on' : ''}`, on ? '✓' : ''));
      row.addEventListener('click', () => toggleSelect(v));
      return node;
    }
    row.addEventListener('click', () => showDetail(v));
    if (stateOf(v) !== 'met') {
      const btn = h('button', 'meet-btn', '✓ मिले');
      btn.type = 'button';
      btn.addEventListener('click', async (e) => {
        e.stopPropagation(); // voter page न खुले
        btn.disabled = true;
        const r = await recordMany([v], { outcome: 'met', scope: 'individual' });
        if (r.error) { btn.disabled = false; msgEl.textContent = r.error; return; }
        toast(msgEl, `✓ ${v.name || 'voter'} — मुलाकात दर्ज हुई।`, r.batch);
      });
      row.append(btn);
    } else {
      const mine = (meets.get(v.voter_id) || []).find((m) => m.outcome === 'met' && canRemove(m));
      if (mine) {
        const btn = h('button', 'meet-undo', '↶');
        btn.type = 'button';
        btn.setAttribute('aria-label', 'मुलाकात का निशान हटाएँ');
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!confirm(`"${v.name || 'voter'}" की मुलाकात का निशान हटाएँ?`)) return;
          const err = await removeRow(mine);
          if (err) alert(`हटाया नहीं जा सका: ${err}`);
        });
        row.append(btn);
      }
    }
    return node;
  }

  function paintList() {
    const list = filtered(false);
    lastList = list;
    if (selectMode) { const ids = new Set(list.map((v) => v.voter_id)); selected = new Set([...selected].filter((id) => ids.has(id))); }
    countEl.textContent = `${list.length} voters`;
    const shown = list.slice(0, limit);
    rowEls = new Map();
    listEl.replaceChildren(...shown.map(rowNode));
    if (!list.length) {
      listEl.append(h('p', 'list-hint', f.show === 'pending' ? 'इस filter में सबसे मुलाकात हो चुकी है 🎉' : 'कोई voter नहीं मिला।'));
    } else {
      listEl.append(h('p', 'list-hint', `${shown.length} / ${list.length} दिखाए गए (Ward → Locality → मकान के क्रम में)`));
    }
    moreBtn.hidden = list.length <= shown.length;
    updateBar();
  }

  function paint() {
    if (!built) return;
    if (loadError && !loaded) { statsEl.replaceChildren(h('p', 'list-hint', `Couldn't load: ${loadError}`)); listEl.replaceChildren(); return; }
    if (!allVoters.length || !loaded) { statsEl.replaceChildren(h('p', 'list-hint', 'Loading…')); listEl.replaceChildren(); return; }
    paintStats();
    paintList();
  }

  // ---------- Bulk चुनाव ----------
  function updateBar() { if (barCount) barCount.textContent = `${selected.size} चुने गए`; }
  function refreshChecks() {
    rowEls.forEach((row, id) => {
      const chk = row.querySelector('.row-check');
      if (!chk) return;
      const on = selected.has(id);
      chk.classList.toggle('on', on);
      chk.textContent = on ? '✓' : '';
    });
    updateBar();
  }
  function toggleSelect(v) {
    const group = wholeHouse && v.house_number ? lastList.filter((x) => famKey(x) === famKey(v)) : [v];
    const turnOn = !selected.has(v.voter_id);
    if (turnOn && selected.size + group.length > MAX_SELECT) { barMsg.textContent = `एक बार में अधिकतम ${MAX_SELECT} चुन सकते हैं।`; return; }
    group.forEach((x) => (turnOn ? selected.add(x.voter_id) : selected.delete(x.voter_id)));
    barMsg.textContent = '';
    refreshChecks();
  }
  function setSelectMode(on) {
    selectMode = on;
    selected = new Set();
    bar.hidden = !on;
    tabPanel.classList.toggle('selecting', on);
    selBtn.textContent = on ? '✕ चुनना बंद करें' : '☑ कई लोगों को चुनें';
    barMsg.textContent = '';
    paintList();
  }

  function syncControls() {
    qIn.value = f.q;
    wardSel.value = f.ward;
    fillLocalities();
    locSel.value = f.loc;
    segEl.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('on', b.dataset.k === f.show));
  }
  function fillLocalities() {
    const inWard = activeVoters().filter((v) => !f.ward || String(v.ward_id) === f.ward);
    const locs = [...new Set(inWard.map((v) => v.locality).filter(Boolean))].sort();
    locSel.replaceChildren(new Option('All localities', ''), ...locs.map((x) => new Option(x, x)));
  }

  function exportPending() {
    const rows = filtered(true).map((v) => ({
      Ward: wardNumbers[v.ward_id] || '', 'Serial No.': v.serial_number ?? '', Name: v.name || '',
      'Relation name': v.relation_name || '', House: v.house_number || '', Locality: v.locality || '',
      Mobile: v.phone || '', Age: v.age ?? '', 'पिछली स्थिति': stateOf(v) === 'tried' ? OUTCOME_SHORT[meets.get(v.voter_id)[0].outcome] : '',
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Baaki');
    XLSX.writeFile(wb, `Mulakat_baaki_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function build() {
    const present = [...new Set(activeVoters().map((v) => v.ward_id))].sort((a, b) => wardNumbers[a] - wardNumbers[b]);
    statsEl = h('div');
    msgEl = h('p', 'action-msg');

    qIn = h('input');
    qIn.type = 'search';
    qIn.placeholder = 'Name, house number, Voter ID या mobile';
    qIn.addEventListener('input', debounce(() => { f.q = qIn.value.trim(); limit = PAGE; paintList(); }, 150));
    wardSel = h('select');
    wardSel.append(new Option('All wards', ''), ...present.map((id) => new Option(`Ward ${wardNumbers[id]}`, String(id))));
    wardSel.addEventListener('change', () => { f.ward = wardSel.value; f.loc = ''; fillLocalities(); limit = PAGE; paintList(); });
    locSel = h('select');
    locSel.addEventListener('change', () => { f.loc = locSel.value; limit = PAGE; paintList(); });
    const sr = h('div', 'search-row');
    sr.append(qIn, wardSel, locSel);

    segEl = h('div', 'seg meet-seg');
    [['pending', 'बाकी (न मिले)'], ['tried', 'प्रयास हुआ'], ['met', 'मिल चुके'], ['all', 'सभी']].forEach(([k, t]) => {
      const b = h('button', 'seg-btn', t);
      b.type = 'button';
      b.dataset.k = k;
      b.addEventListener('click', () => { f.show = k; limit = PAGE; syncControls(); paintList(); });
      segEl.append(b);
    });

    selBtn = h('button', 'edit-btn', '☑ कई लोगों को चुनें');
    selBtn.type = 'button';
    selBtn.addEventListener('click', () => setSelectMode(!selectMode));
    const tools = h('div', 'list-tools');
    tools.append(selBtn);

    countEl = h('div', 'voter-count');
    listEl = h('div', 'voter-list');
    moreBtn = h('button', 'visit-btn', 'और दिखाएँ');
    moreBtn.type = 'button';
    moreBtn.hidden = true;
    moreBtn.addEventListener('click', () => { limit += PAGE; paintList(); });

    // नीचे चिपका रहने वाला bulk bar
    bar = h('div', 'select-bar');
    bar.hidden = true;
    barCount = h('span', null, '0 चुने गए');
    const info = h('div', 'select-info');
    info.append(barCount,
      linkBtn('सब चुनें', () => {
        selected = new Set(lastList.slice(0, MAX_SELECT).map((v) => v.voter_id));
        barMsg.textContent = lastList.length > MAX_SELECT ? `पहले ${MAX_SELECT} चुने गए — filter कसकर बाकी चुनिए।` : '';
        refreshChecks();
      }),
      linkBtn('हटाएँ', () => { selected = new Set(); refreshChecks(); }));
    const houseLbl = h('label', 'meet-house');
    const houseChk = h('input');
    houseChk.type = 'checkbox';
    houseChk.checked = wholeHouse;
    houseChk.addEventListener('change', () => { wholeHouse = houseChk.checked; });
    houseLbl.append(houseChk, document.createTextNode(' 🏠 पूरा घर साथ चुनें'));
    noteIn = h('input');
    noteIn.type = 'text';
    noteIn.maxLength = 500;
    noteIn.placeholder = 'Note (optional)';
    outSel = outcomeSelect();
    addBtn = h('button', 'visit-btn', 'दर्ज करें');
    addBtn.type = 'button';
    barMsg = h('p', 'action-msg');
    const actions = h('div', 'select-actions');
    actions.append(outSel, addBtn);
    addBtn.addEventListener('click', async () => {
      const list = allVoters.filter((v) => selected.has(v.voter_id));
      if (!list.length) { barMsg.textContent = 'पहले कुछ voters चुनिए।'; return; }
      const outcome = outSel.value;
      if (!confirm(`${list.length} voters — "${OUTCOME_SHORT[outcome]}" दर्ज करें?`)) return;
      addBtn.disabled = true;
      barMsg.textContent = 'Saving…';
      const r = await recordMany(list, { outcome, scope: 'bulk', note: noteIn.value.trim() });
      addBtn.disabled = false;
      if (r.error) { barMsg.textContent = r.error; return; }
      toast(barMsg, `✓ ${r.count} voters दर्ज हुए।`, r.batch);
      selected = new Set();
      noteIn.value = '';
      refreshChecks();
    });
    bar.append(info, houseLbl, noteIn, actions, barMsg);

    const parts = [
      h('h2', 'panel-title', '🤝 व्यक्तिगत मुलाकात'),
      h('p', 'muted', 'जिस voter से कोई न कोई व्यक्तिगत रूप से मिल लिया, उसके आगे "✓ मिले" दबाइए। पूरे घर या कई लोगों के लिए "कई लोगों को चुनें" इस्तेमाल करें।'),
      statsEl, h('div', 'dash-gap'),
    ];
    if (window.meetReportPanel) parts.push(window.meetReportPanel(), h('div', 'dash-gap'));
    parts.push(sr, segEl, tools, countEl, msgEl, listEl, moreBtn);
    if (isAdmin()) {
      const xl = h('button', 'edit-btn', '⬇ बाकी voters की सूची (Excel)');
      xl.type = 'button';
      xl.addEventListener('click', exportPending);
      parts.push(h('div', 'dash-gap'), xl);
    }
    parts.push(bar);
    root.replaceChildren(...parts);
    built = true;
    syncControls();
  }

  // ---------- Family / Group पेज का "🤝 सबसे मिले" हिस्सा (groups.js बुलाता है) ----------
  window.meetGroupBlock = (members, scope) => {
    const list = members.filter((v) => v.is_active);
    const box = h('div', 'meet-box');
    if (!list.length) return box;
    const sum = h('div', 'meet-gsum');
    const open = h('button', 'visit-btn', '🤝 सबसे मिले');
    open.type = 'button';
    const panel = h('div', 'meet-pick');
    panel.hidden = true;
    const msg = h('p', 'action-msg');
    const refreshSum = () => {
      const m = list.filter((v) => stateOf(v) === 'met').length;
      sum.textContent = loaded ? `🤝 व्यक्तिगत मुलाकात: ${m} / ${list.length} से हो चुकी` : '🤝 व्यक्तिगत मुलाकात — Loading…';
    };
    function renderPanel() {
      const checks = [];
      const rows = list.map((v) => {
        const met = stateOf(v) === 'met';
        const lab = h('label', `meet-pick-row${met ? ' done' : ''}`);
        const c = h('input');
        c.type = 'checkbox';
        c.checked = !met;   // जो मिल चुके वे बंद; बाकी सब पहले से ✓ — जो घर पर नहीं थे उनका ✓ हटाइए
        c.disabled = met;
        checks.push([v, c]);
        const [txt] = statusLine(v);
        const info = h('span', 'meet-pick-info');
        info.append(h('span', 'meet-pick-name', v.name || '(name pending)'),
          h('span', 'meet-pick-meta', `${v.age || '?'} yrs · ${GENDER_LABEL[v.gender] || '—'} · ${txt}`));
        lab.append(c, info);
        return lab;
      });
      const out = outcomeSelect();
      const note = h('input');
      note.type = 'text';
      note.maxLength = 500;
      note.placeholder = 'Note (optional)';
      const go = h('button', 'visit-btn');
      go.type = 'button';
      const chosen = () => checks.filter(([, c]) => c.checked && !c.disabled).map(([v]) => v);
      const upd = () => { go.textContent = `दर्ज करें (${chosen().length})`; };
      checks.forEach(([, c]) => c.addEventListener('change', upd));
      upd();
      go.addEventListener('click', async () => {
        const pick = chosen();
        if (!pick.length) { msg.textContent = 'पहले कुछ नाम चुनिए।'; return; }
        go.disabled = true;
        msg.textContent = 'Saving…';
        const r = await recordMany(pick, { outcome: out.value, scope, note: note.value.trim() });
        go.disabled = false;
        if (r.error) { msg.textContent = r.error; return; }
        toast(msg, `✓ ${r.count} नाम दर्ज हुए।`, r.batch);
        refreshSum();
        renderPanel();
      });
      panel.replaceChildren(...rows, out, note, go);
    }
    open.addEventListener('click', () => { panel.hidden = !panel.hidden; if (!panel.hidden) renderPanel(); });
    refreshSum();
    ensureLoaded().then(() => { refreshSum(); if (!panel.hidden) renderPanel(); });
    box.append(sum, open, panel, msg);
    return box;
  };

  // ---------- Voter के पेज (voters.js) का हिस्सा ----------
  window.meetingSection = (v) => {
    const box = h('div', 'meet-box');
    box.append(h('div', 'section-label', 'व्यक्तिगत मुलाकात'));
    const hist = h('div', 'history');
    const sel = outcomeSelect();
    const note = h('textarea');
    note.rows = 2;
    note.maxLength = 500;
    note.placeholder = 'Note (optional) — क्या बात हुई?';
    const btn = h('button', 'visit-btn', '🤝 दर्ज करें');
    btn.type = 'button';
    const msg = h('p', 'action-msg');
    const paintHist = () => {
      const l = meets.get(v.voter_id) || [];
      if (!l.length) { hist.replaceChildren(h('p', 'muted', loaded ? 'अभी तक कोई मुलाकात या प्रयास दर्ज नहीं हुआ।' : 'Loading…')); return; }
      hist.replaceChildren(...l.map((m) => {
        const item = h('div', 'history-item');
        item.append(h('div', null, OUTCOME[m.outcome] || '🤝 मुलाकात'));
        if (m.note) item.append(h('div', 'note', m.note));
        item.append(h('div', 'when', `${names[m.user_id] || 'Someone'} · ${whenText(m.met_at)}${m.scope && m.scope !== 'individual' ? ` · ${{ family: 'परिवार', group: 'group', bulk: 'bulk' }[m.scope] || ''}` : ''}`));
        if (canRemove(m)) {
          const del = h('button', 'meet-del', '🗑 हटाएँ');
          del.type = 'button';
          del.addEventListener('click', async () => {
            if (!confirm('यह एंट्री हटाएँ?')) return;
            const err = await removeRow(m);
            if (err) msg.textContent = `हटाया नहीं जा सका: ${err}`; else paintHist();
          });
          item.append(del);
        }
        return item;
      }));
    };
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      msg.textContent = 'Saving…';
      const r = await recordMany([v], { outcome: sel.value, scope: 'individual', note: note.value.trim() });
      btn.disabled = false;
      if (r.error) { msg.textContent = r.error; return; }
      note.value = '';
      msg.textContent = 'Saved ✓';
      paintHist();
    });
    box.append(hist, sel, note, btn, msg);
    paintHist();
    if (!loaded) loadMeets().then(paintHist);
    return box;
  };

  // PDF रिपोर्ट (meet-report.js) के लिए
  window.meetApi = {
    stateOf, cmpHouse, famKey, ensureLoaded, OUTCOME_SHORT,
    lastAttempt: (v) => { const l = meets.get(v.voter_id); return l ? l[0] : null; },
    filters: () => ({ ...f }),
  };

  // ---------- Wiring ----------
  tabBtn.addEventListener('click', () => {
    if (!built) build();
    paint();
    loadMeets();
  });
  document.addEventListener('voters-loaded', () => { built = false; if (visible()) { build(); paint(); } });
  document.addEventListener('detail-closed', () => { if (built) paint(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && visible()) loadMeets(); });
  setInterval(() => { if (visible() && !selectMode) loadMeets(); }, 45000);
  document.addEventListener('user-gone', () => {
    meets = new Map();
    loaded = false;
    built = false;
    loadError = '';
    limit = PAGE;
    selectMode = false;
    selected = new Set();
    tabPanel.classList.remove('selecting');
    Object.assign(f, { q: '', ward: '', loc: '', show: 'pending' });
    root.replaceChildren();
  });
})();
