// 🤝 व्यक्तिगत मुलाकात — किस voter से कोई न कोई व्यक्तिगत रूप से मिल लिया है, इसका रिकॉर्ड.
// मक़सद: 24 तारीख़ से पहले कोई भी voter व्यक्तिगत मुलाकात से वंचित न रहे.
// सिर्फ़ नई टेबल `voter_meetings` इस्तेमाल होती है (Visit log / voter_events अलग ही रहता है).
// voters.js से ये चीज़ें इस्तेमाल होती हैं: allVoters, wardNumbers, names, h, rowTemplate,
// photoSrc, showDetail, matchesSearch, bySerial.
(() => {
  const POLL_DAY = '2026-10-24'; // मतदान की तारीख़ (बदलनी हो तो सिर्फ़ यही)
  const PAGE = 50;
  const root = document.getElementById('meet-root');
  const tabBtn = document.getElementById('meet-tab-btn');

  let meets = new Map();   // voter_id -> [मुलाकातें, नई पहले]
  let loaded = false;
  let loading = false;
  let loadError = '';
  let built = false;
  let limit = PAGE;
  const f = { q: '', ward: '', loc: '', show: 'pending' }; // filters
  let statsEl, listEl, countEl, msgEl, qIn, wardSel, locSel, segEl, moreBtn;

  const whenText = (t) => new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const isAdmin = () => !!(window.appUser && window.appUser.isAdmin);
  const visible = () => !document.hidden && !document.getElementById('app-view').hidden && !document.getElementById('meet-tab').hidden;
  const activeVoters = () => allVoters.filter((v) => v.is_active);
  const isMet = (v) => meets.has(v.voter_id);

  function daysLeft() {
    const t = new Date(`${POLL_DAY}T00:00:00`);
    const n = new Date();
    n.setHours(0, 0, 0, 0);
    return Math.round((t - n) / 86400000);
  }

  // ---------- Data ----------
  async function loadMeets() {
    if (loading) return;
    loading = true;
    try {
      const rows = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from('voter_meetings')
          .select('meeting_id, voter_id, user_id, met_at, note').order('meeting_id').range(from, from + 999);
        if (error) throw error;
        rows.push(...data);
        if (data.length < 1000) break;
      }
      const m = new Map();
      rows.forEach((r) => { if (!m.has(r.voter_id)) m.set(r.voter_id, []); m.get(r.voter_id).unshift(r); }); // नई पहले
      meets = m;
      loaded = true;
      loadError = '';
    } catch (e) {
      loadError = e.message || String(e);
    }
    loading = false;
    if (built) paint();
  }

  // दर्ज करने पर true, वरना error का text लौटाता है
  async function record(v, note) {
    const row = { voter_id: v.voter_id, user_id: window.appUser.id };
    if (note) row.note = note;
    const { data, error } = await sb.from('voter_meetings').insert(row)
      .select('meeting_id, voter_id, user_id, met_at, note').single();
    if (error) return `दर्ज नहीं हुआ: ${error.message}`;
    const l = meets.get(v.voter_id) || [];
    l.unshift(data);
    meets.set(v.voter_id, l);
    if (built) paint();
    return true;
  }

  async function undo(v, m) {
    if (!confirm(`"${v.name || 'voter'}" की मुलाकात का निशान हटाएँ?`)) return;
    const { error } = await sb.from('voter_meetings').delete().eq('meeting_id', m.meeting_id);
    if (error) { alert(`हटाया नहीं जा सका: ${error.message}`); return; }
    const l = (meets.get(v.voter_id) || []).filter((x) => x.meeting_id !== m.meeting_id);
    if (l.length) meets.set(v.voter_id, l); else meets.delete(v.voter_id);
    if (built) paint();
  }

  // ---------- Filtering ----------
  function filtered(pendingOnly) {
    const show = pendingOnly ? 'pending' : f.show;
    const out = activeVoters().filter((v) =>
      matchesSearch(v, f.q) && (!f.loc || v.locality === f.loc) && (!f.ward || String(v.ward_id) === f.ward) &&
      (show === 'all' || (show === 'met') === isMet(v)));
    if (show === 'met') return out.sort((a, b) => (meets.get(b.voter_id)[0].met_at).localeCompare(meets.get(a.voter_id)[0].met_at));
    return out.sort(bySerial);
  }

  // ---------- Painting ----------
  function paintStats() {
    const act = activeVoters();
    const met = act.filter(isMet).length;
    const left = act.length - met;
    const d = daysLeft();
    const card = h('div', 'meet-card');
    card.append(h('div', 'meet-big', `${met} / ${act.length}`),
      h('div', 'meet-sub', `voters से व्यक्तिगत मुलाकात हो चुकी (${act.length ? Math.round((met * 1000) / act.length) / 10 : 0}%)`));
    const bar = h('div', 'meet-bar');
    const fill = h('span');
    fill.style.width = `${act.length ? (met * 100) / act.length : 0}%`;
    bar.append(fill);
    card.append(bar);
    let line = `मिलना बाकी: ${left}`;
    if (d > 0 && left) line += ` · मतदान में ${d} दिन बाकी — रोज़ लगभग ${Math.ceil(left / d)} से मिलना होगा`;
    else if (d === 0) line += ' · आज मतदान का दिन है';
    card.append(h('div', 'meet-sub', line));

    const byWard = new Map();
    act.forEach((v) => {
      const s = byWard.get(v.ward_id) || { t: 0, m: 0 };
      s.t++;
      if (isMet(v)) s.m++;
      byWard.set(v.ward_id, s);
    });
    const tb = h('table', 'dash-table');
    const head = h('tr');
    ['Ward', 'कुल', 'मिले', 'बाकी'].forEach((x) => head.append(h('th', null, x)));
    tb.append(head);
    [...byWard.entries()].sort((a, b) => wardNumbers[a[0]] - wardNumbers[b[0]]).forEach(([id, s]) => {
      const tr = h('tr');
      const td = h('td');
      const b = h('button', 'dash-link', `Ward ${wardNumbers[id]} ›`);
      b.type = 'button';
      b.addEventListener('click', () => { f.ward = String(id); f.loc = ''; f.show = 'pending'; syncControls(); limit = PAGE; paint(); });
      td.append(b);
      tr.append(td, h('td', null, s.t), h('td', null, s.m), h('td', null, s.t - s.m));
      tb.append(tr);
    });
    statsEl.replaceChildren(card, tb);
  }

  function rowNode(v) {
    const node = rowTemplate.content.cloneNode(true);
    const row = node.querySelector('.voter-row');
    const img = node.querySelector('.voter-thumb');
    if (v.photo_url) img.src = photoSrc(v); else img.classList.add('no-photo');
    node.querySelector('.voter-row-name').textContent = v.name || '(name pending)';
    node.querySelector('.voter-row-meta').textContent =
      `Ward ${wardNumbers[v.ward_id] || '?'} · House ${v.house_number || '—'} · ${v.locality || '—'}`;
    const l = meets.get(v.voter_id);
    const info = node.querySelector('.voter-row-info');
    info.append(h('div', `voter-row-meta meet-status${l ? ' done' : ''}`, l
      ? `✓ ${names[l[0].user_id] || 'Someone'} · ${whenText(l[0].met_at)}${l.length > 1 ? ` (+${l.length - 1})` : ''}`
      : 'अभी तक नहीं मिले'));
    row.addEventListener('click', () => showDetail(v));

    const btn = h('button', l ? 'meet-undo' : 'meet-btn', l ? '↶' : '✓ मिले');
    btn.type = 'button';
    if (!l) {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation(); // voter page न खुले
        btn.disabled = true;
        const r = await record(v, '');
        if (r !== true) { btn.disabled = false; msgEl.textContent = r; return; }
        msgEl.textContent = `✓ ${v.name || 'voter'} — मुलाकात दर्ज हुई`;
      });
      row.append(btn);
    } else {
      const mine = l.find((m) => isAdmin() || m.user_id === window.appUser.id);
      if (mine) {
        btn.setAttribute('aria-label', 'मुलाकात का निशान हटाएँ');
        btn.addEventListener('click', (e) => { e.stopPropagation(); undo(v, mine); });
        row.append(btn);
      }
    }
    return node;
  }

  function paintList() {
    const list = filtered(false);
    countEl.textContent = `${list.length} voters`;
    const shown = list.slice(0, limit);
    listEl.replaceChildren(...shown.map(rowNode));
    if (!list.length) {
      listEl.append(h('p', 'list-hint', f.show === 'pending' ? 'इस filter में सबसे मुलाकात हो चुकी है 🎉' : 'कोई voter नहीं मिला।'));
    } else {
      listEl.append(h('p', 'list-hint', `${shown.length} / ${list.length} दिखाए गए (serial number के क्रम में)`));
    }
    moreBtn.hidden = list.length <= shown.length;
  }

  function paint() {
    if (!built) return;
    if (loadError) { statsEl.replaceChildren(h('p', 'list-hint', `Couldn't load: ${loadError}`)); }
    else if (!allVoters.length || !loaded) { statsEl.replaceChildren(h('p', 'list-hint', 'Loading…')); listEl.replaceChildren(); return; }
    else paintStats();
    if (!loadError) paintList();
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
      Mobile: v.phone || '', Age: v.age ?? '',
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
    [['pending', 'बाकी (न मिले)'], ['met', 'मिल चुके'], ['all', 'सभी']].forEach(([k, t]) => {
      const b = h('button', 'seg-btn', t);
      b.type = 'button';
      b.dataset.k = k;
      b.addEventListener('click', () => { f.show = k; limit = PAGE; syncControls(); paintList(); });
      segEl.append(b);
    });

    countEl = h('div', 'voter-count');
    listEl = h('div', 'voter-list');
    moreBtn = h('button', 'visit-btn', 'और दिखाएँ');
    moreBtn.type = 'button';
    moreBtn.hidden = true;
    moreBtn.addEventListener('click', () => { limit += PAGE; paintList(); });

    const parts = [
      h('h2', 'panel-title', '🤝 व्यक्तिगत मुलाकात'),
      h('p', 'muted', 'जिस voter से कोई न कोई व्यक्तिगत रूप से मिल लिया, उसके आगे "✓ मिले" दबाइए। जो बाकी रहें, उनसे मतदान से पहले मिलना है।'),
      statsEl, h('div', 'dash-gap'), sr, segEl, countEl, msgEl, listEl, moreBtn,
    ];
    if (isAdmin()) {
      const xl = h('button', 'edit-btn', '⬇ बाकी voters की सूची (Excel)');
      xl.type = 'button';
      xl.addEventListener('click', exportPending);
      parts.push(h('div', 'dash-gap'), xl, h('p', 'muted', 'ऊपर चुने ward / locality के हिसाब से, सिर्फ़ वे जिनसे अभी नहीं मिले।'));
    }
    root.replaceChildren(...parts);
    built = true;
    syncControls();
  }

  // voters.js के voter page में जुड़ने वाला हिस्सा (groupSection की तरह)
  window.meetingSection = (v) => {
    const box = h('div', 'meet-box');
    box.append(h('div', 'section-label', 'व्यक्तिगत मुलाकात'));
    const hist = h('div', 'history');
    const note = h('textarea');
    note.rows = 2;
    note.maxLength = 500;
    note.placeholder = 'Note (optional) — क्या बात हुई?';
    const btn = h('button', 'visit-btn', '🤝 व्यक्तिगत मुलाकात हो गई');
    btn.type = 'button';
    const msg = h('p', 'action-msg');
    const paintHist = () => {
      const l = meets.get(v.voter_id) || [];
      if (!l.length) { hist.replaceChildren(h('p', 'muted', loaded ? 'अभी तक किसी की व्यक्तिगत मुलाकात दर्ज नहीं हुई।' : 'Loading…')); return; }
      hist.replaceChildren(...l.map((m) => {
        const item = h('div', 'history-item');
        item.append(h('div', null, '🤝 व्यक्तिगत मुलाकात'));
        if (m.note) item.append(h('div', 'note', m.note));
        item.append(h('div', 'when', `${names[m.user_id] || 'Someone'} · ${whenText(m.met_at)}`));
        return item;
      }));
    };
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      msg.textContent = 'Saving…';
      const r = await record(v, note.value.trim());
      btn.disabled = false;
      if (r === true) { note.value = ''; msg.textContent = 'Saved ✓'; paintHist(); } else msg.textContent = r;
    });
    box.append(hist, note, btn, msg);
    paintHist();
    if (!loaded) loadMeets().then(paintHist);
    return box;
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
  setInterval(() => { if (visible()) loadMeets(); }, 45000);
  document.addEventListener('user-gone', () => {
    meets = new Map();
    loaded = false;
    built = false;
    loadError = '';
    limit = PAGE;
    Object.assign(f, { q: '', ward: '', loc: '', show: 'pending' });
    root.replaceChildren();
  });
})();
