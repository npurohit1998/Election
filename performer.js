// Performers — volunteer scoreboard (points, ranks, badges). READ-ONLY: only reads voter_events.
// Anti-gaming: one voter + one kind of work counts once per day per volunteer.
(() => {
  const root = document.getElementById('perf-root');
  const tabBtn = document.getElementById('performer-tab-btn');

  const POINTS = { visit: 10, voted: 8, support_change: 5, phone: 5, call: 3, whatsapp: 3, edit: 2 };
  const LABEL = { visit: 'Visit', voted: 'Voted निशान', support_change: 'Support', phone: 'नंबर', call: 'Call', whatsapp: 'WhatsApp', edit: 'सुधार' };
  const PERIODS = [['today', 'आज'], ['week', '7 दिन'], ['all', 'कुल']];
  const STAR = { today: 'आज का सितारा', week: 'इस हफ़्ते का सितारा', all: 'अब तक का सितारा' };
  let period = 'today';
  let board = null; // Map user_id -> stats
  let loadedAt = 0;
  let stampText = '';
  let loading = false;

  const dayKey = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

  function kindOf(ev) {
    const t = ev.event_type;
    if (t === 'edit') return ev.note === 'phone' ? 'phone' : 'edit';
    if (t === 'voted') return ev.new_value === 'true' ? 'voted' : null;
    if (t === 'support_change' || t === 'call' || t === 'whatsapp') return t;
    return 'visit'; // same default as the History view
  }

  const blank = () => ({ today: { pts: 0 }, week: { pts: 0 }, all: { pts: 0 }, days: new Set(), streak: 0 });

  function build(events) {
    const now = new Date();
    const todayKey = dayKey(now);
    const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).getTime();
    const out = new Map(Object.keys(names).map((id) => [id, blank()]));
    const seen = new Set();
    events.forEach((ev) => {
      const kind = kindOf(ev);
      if (!kind || !ev.user_id) return;
      const t = new Date(ev.created_at);
      const day = dayKey(t);
      const key = `${ev.user_id}|${ev.voter_id}|${kind}|${day}`;
      if (seen.has(key)) return;
      seen.add(key);
      if (!out.has(ev.user_id)) out.set(ev.user_id, blank());
      const s = out.get(ev.user_id);
      const ps = ['all'];
      if (t.getTime() >= weekStart) ps.push('week');
      if (day === todayKey) ps.push('today');
      ps.forEach((p) => { s[p][kind] = (s[p][kind] || 0) + 1; s[p].pts += POINTS[kind]; });
      s.days.add(day);
    });
    out.forEach((s) => {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      if (!s.days.has(dayKey(d))) d.setDate(d.getDate() - 1); // today not done yet: streak may still be alive
      while (s.days.has(dayKey(d))) { s.streak++; d.setDate(d.getDate() - 1); }
    });
    return out;
  }

  function badgesOf(s) {
    const n = (k) => s.all[k] || 0;
    const b = [];
    if (n('visit') >= 25) b.push('🏃 Field Star');
    if (n('call') + n('whatsapp') >= 30) b.push('📞 Communicator');
    if (n('phone') >= 15) b.push('📱 Number Hunter');
    if (n('support_change') >= 30) b.push('🎯 Surveyor');
    if (s.streak >= 3) b.push(`🔥 ${s.streak} दिन लगातार`);
    return b;
  }

  async function fetchEvents() {
    const all = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from('voter_events')
        .select('voter_id, user_id, event_type, new_value, note, created_at')
        .order('created_at').order('voter_id').range(from, from + 999);
      if (error) throw error;
      all.push(...data);
      if (data.length < 1000) break;
    }
    return all;
  }

  function render() {
    const list = [...board.entries()]
      .map(([id, s]) => ({ id, s, p: s[period], name: names[id] || 'Someone' }))
      .sort((a, b) => b.p.pts - a.p.pts || a.name.localeCompare(b.name));
    list.forEach((r, i) => { r.rank = i && r.p.pts === list[i - 1].p.pts ? list[i - 1].rank : i + 1; });
    const max = list.length ? Math.max(1, list[0].p.pts) : 1;
    const medal = ['🥇', '🥈', '🥉'];
    const me = list.find((r) => window.appUser && r.id === window.appUser.id);
    const wrap = h('div');

    wrap.append(h('h2', 'panel-title', '🏆 Performers'), h('p', 'muted', 'हर volunteer के काम के अंक और रैंक'));

    const seg = h('div', 'seg');
    PERIODS.forEach(([k, t]) => {
      const b = h('button', `seg-btn${period === k ? ' on' : ''}`, t);
      b.type = 'button';
      b.addEventListener('click', () => { period = k; render(); });
      seg.append(b);
    });
    wrap.append(seg);

    const top = list[0];
    if (top && top.p.pts > 0) wrap.append(h('div', 'perf-star', `⭐ ${STAR[period]}: ${top.name} — ${top.p.pts} अंक`));
    if (me) {
      wrap.append(h('p', 'perf-me', me.p.pts
        ? `आपकी रैंक: #${me.rank} · ${me.p.pts} अंक`
        : 'इस अवधि में आपके अभी कोई अंक नहीं — पहला visit या call करके शुरुआत कीजिए!'));
    }

    list.forEach((r) => {
      const row = h('div', `perf-row${me && r.id === me.id ? ' me' : ''}`);
      const parts = Object.keys(POINTS).filter((k) => r.p[k]).map((k) => `${r.p[k]} ${LABEL[k]}`);
      const body = h('div', 'perf-body');
      body.append(h('div', 'perf-name', r.name), h('div', 'perf-stats', parts.length ? parts.join(' · ') : 'अभी कोई काम नहीं'));
      const bs = badgesOf(r.s);
      if (bs.length) {
        const bx = h('div', 'perf-badges');
        bs.forEach((x) => bx.append(h('span', 'perf-badge', x)));
        body.append(bx);
      }
      const bar = h('div', 'perf-bar');
      const fill = h('span');
      fill.style.width = `${(r.p.pts * 100) / max}%`;
      bar.append(fill);
      body.append(bar);
      const pts = h('div', 'perf-pts', r.p.pts);
      pts.append(h('small', null, 'अंक'));
      row.append(h('div', 'perf-rank', r.p.pts ? (medal[r.rank - 1] || `#${r.rank}`) : '—'), body, pts);
      wrap.append(row);
    });

    const rb = h('button', 'dash-link', '↻ Refresh');
    rb.type = 'button';
    rb.addEventListener('click', () => load(true));
    const rf = h('div', 'dash-refresh');
    rf.append(rb, h('span', 'muted', stampText));
    wrap.append(h('p', 'perf-rules',
      'अंक: Visit 10 · Voted निशान 8 · Support मूल्यांकन 5 · नंबर जोड़ना 5 · Call 3 · WhatsApp 3 · सुधार 2।\n' +
      'एक voter पर एक तरह का काम दिन में सिर्फ़ एक बार गिना जाता है, इसलिए बार-बार दबाने से अंक नहीं बढ़ेंगे। ' +
      'Call / WhatsApp में बटन दबाना गिना जाता है।'), rf);
    root.replaceChildren(wrap);
  }

  async function load(force) {
    if (loading) return;
    if (board && !force && Date.now() - loadedAt < 60000) { render(); return; }
    loading = true;
    if (!board) root.replaceChildren(h('p', 'list-hint', 'Loading…'));
    try {
      board = build(await fetchEvents());
      loadedAt = Date.now();
      stampText = `अपडेट: ${new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`;
      render();
    } catch (e) {
      root.replaceChildren(h('p', 'list-hint', `Couldn't load: ${e.message || e}`));
    }
    loading = false;
  }

  tabBtn.addEventListener('click', () => load(false));
  document.addEventListener('user-gone', () => { board = null; root.replaceChildren(); });
})();
