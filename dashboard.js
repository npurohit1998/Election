// Admin dashboard — READ-ONLY. Nothing here writes to the database.
// Uses data already loaded by voters.js / groups.js (allVoters, wardNumbers,
// names, groups, memberships, h, showDetail, photoSrc, label maps).
(() => {
  const dashRoot = document.getElementById('dash-root');
  const dashTabBtn = document.getElementById('dashboard-tab-btn');
  const SUP_KEYS = ['strong_support', 'leaning', 'opposition'];
  const dash = { ward: null, list: null }; // ward = ward_id; list = { title, pick }

  const supOf = (v) => v.support_level || 'unknown';
  const pct = (n, t) => (t ? `${Math.round((n * 1000) / t) / 10}%` : '0%');
  const today = () => new Date().toISOString().slice(0, 10);

  function tally(voters) {
    const c = { total: voters.length, strong_support: 0, leaning: 0, undecided: 0, opposition: 0, unknown: 0 };
    voters.forEach((v) => { const k = supOf(v); c[k] = (c[k] || 0) + 1; });
    return c;
  }

  function groupBy(list, keyFn) {
    const m = new Map();
    list.forEach((v) => { const k = keyFn(v); if (!m.has(k)) m.set(k, []); m.get(k).push(v); });
    return m;
  }

  const sortV = (arr) => [...arr].sort((a, b) =>
    (wardNumbers[a.ward_id] - wardNumbers[b.ward_id]) ||
    String(a.locality || '').localeCompare(String(b.locality || '')) ||
    String(a.house_number || '').localeCompare(String(b.house_number || ''), undefined, { numeric: true }));

  // ---------- Excel ----------
  function exportRow(v) {
    return {
      Ward: wardNumbers[v.ward_id] || '', 'Serial No.': v.serial_number ?? '', 'Voter ID': realEpic(v),
      Name: v.name || '', Relation: RELATION_LABEL[v.relation_type] || '', 'Relation name': v.relation_name || '',
      House: v.house_number || '', Age: v.age ?? '', Gender: GENDER_LABEL[v.gender] || '',
      Locality: v.locality || '', Support: SUPPORT_LABEL[supOf(v)] || supOf(v), Voted: v.voted ? 'Yes' : 'No',
      Status: STATUS_LABEL[v.deletion_status] || (v.is_active ? 'Active' : 'Inactive'),
    };
  }

  function saveXlsx(filename, sheets) {
    const wb = XLSX.utils.book_new();
    sheets.forEach(([name, rows]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name));
    XLSX.writeFile(wb, filename);
  }

  async function runBackup(btn, msg) {
    btn.disabled = true;
    try {
      const byId = new Map(allVoters.map((v) => [v.voter_id, v]));
      const voterRows = allVoters.map((v) => ({ ...exportRow(v), 'Internal ID': v.voter_id }));

      const events = [];
      for (let from = 0; ; from += 1000) {
        msg.textContent = `History पढ़ी जा रही है… ${events.length}`;
        const { data, error } = await sb.from('voter_events').select('*')
          .order('created_at').order('voter_id').range(from, from + 999);
        if (error) throw error;
        events.push(...data);
        if (data.length < 1000) break;
      }
      const histRows = events.map((ev) => ({
        When: new Date(ev.created_at).toLocaleString('en-IN'),
        Voter: (byId.get(ev.voter_id) || {}).name || '', 'Internal ID': ev.voter_id,
        By: names[ev.user_id] || '', What: describeEvent(ev), Type: ev.event_type,
        Old: ev.old_value ?? '', New: ev.new_value ?? '', Note: ev.note ?? '',
      }));

      const gName = new Map(groups.map((g) => [g.group_id, g.name]));
      const groupRows = memberships.map((m) => ({
        Group: gName.get(m.group_id) || m.group_id, Voter: (byId.get(m.voter_id) || {}).name || '', 'Internal ID': m.voter_id,
      }));

      const sheets = [['Voters', voterRows], ['History', histRows]];
      if (groupRows.length) sheets.push(['Groups', groupRows]);
      msg.textContent = 'Excel file बन रही है…';
      saveXlsx(`Lordiya_backup_${today()}.xlsx`, sheets);
      msg.textContent = `Backup तैयार ✓ — ${voterRows.length} voters, ${histRows.length} history entries`;
    } catch (e) {
      msg.textContent = `Backup नहीं बन सका: ${e.message || e}`;
    }
    btn.disabled = false;
  }

  // ---------- Views ----------
  function openList(title, pick) {
    dash.list = { title, pick };
    renderDash();
    window.scrollTo(0, 0);
  }

  function dashBar(t) {
    const bar = h('div', 'dash-bar');
    [...SUP_KEYS, 'undecided', 'unknown'].forEach((k) => {
      if (!t[k]) return;
      const s = h('span', k);
      s.style.width = `${(t[k] * 100) / t.total}%`;
      bar.append(s);
    });
    return bar;
  }

  function linkBtn(text, onClick) {
    const b = h('button', 'dash-link', text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  // rows: [{ label, title, voters, open? }] — numbers open the voter list
  function statTable(firstHead, rows) {
    const tb = h('table', 'dash-table');
    const head = h('tr');
    [firstHead, 'कुल', 'Strong', 'Leaning', 'Opp.'].forEach((x) => head.append(h('th', null, x)));
    tb.append(head);
    rows.forEach((r) => {
      const t = tally(r.voters);
      const tr = h('tr');
      const first = h('td');
      if (r.open) first.append(linkBtn(`${r.label} ›`, r.open)); else first.textContent = r.label;
      tr.append(first, h('td', null, t.total));
      SUP_KEYS.forEach((k) => {
        const td = h('td');
        const b = h('button', 'dash-num', t[k]);
        b.type = 'button';
        b.disabled = !t[k];
        b.addEventListener('click', () =>
          openList(`${r.title} — ${SUPPORT_LABEL[k]}`, () => r.voters.filter((v) => v.is_active && supOf(v) === k)));
        td.append(b);
        tr.append(td);
      });
      tb.append(tr);
    });
    return tb;
  }

  function dashRow(v) {
    const node = rowTemplate.content.cloneNode(true);
    const img = node.querySelector('.voter-thumb');
    if (v.photo_url) img.src = photoSrc(v); else img.classList.add('no-photo');
    node.querySelector('.voter-row-name').textContent = v.name || '(name pending)';
    node.querySelector('.voter-row-meta').textContent =
      `Ward ${wardNumbers[v.ward_id] || '?'} · House ${v.house_number || '—'} · ${v.locality || '—'}` +
      (v.voted ? ' · ✓ Voted' : '');
    node.querySelector('.voter-row').addEventListener('click', () => showDetail(v));
    return node;
  }

  function renderDashList() {
    const { title, pick } = dash.list;
    const voters = sortV(pick());
    const back = h('button', 'back-link', '← Dashboard');
    back.type = 'button';
    back.addEventListener('click', () => { dash.list = null; renderDash(); });

    const xl = h('button', 'visit-btn', `⬇ Excel में डाउनलोड (${voters.length})`);
    xl.type = 'button';
    xl.disabled = !voters.length;
    xl.addEventListener('click', () =>
      saveXlsx(`${title.replace(/[^\w\u0900-\u097F-]+/g, '_')}_${today()}.xlsx`, [['List', voters.map(exportRow)]]));

    const box = h('div', 'voter-list');
    voters.slice(0, 200).forEach((v) => box.append(dashRow(v)));
    if (voters.length > 200) {
      box.append(h('p', 'list-hint', `200 / ${voters.length} दिखाए गए — पूरी सूची Excel में मिलेगी।`));
    }
    if (!voters.length) box.append(h('p', 'list-hint', 'इस सूची में कोई voter नहीं।'));

    dashRoot.replaceChildren(back, h('h2', 'panel-title', title), h('p', 'muted', `${voters.length} voters`), xl, h('div', 'dash-gap'), box);
  }

  function renderDash() {
    if (!window.appUser || !window.appUser.isAdmin) return;
    if (!allVoters.length) { dashRoot.replaceChildren(h('p', 'list-hint', 'Loading…')); return; }
    if (dash.list) return renderDashList();

    const active = allVoters.filter((v) => v.is_active);
    if (dash.ward && !active.some((v) => v.ward_id === dash.ward)) dash.ward = null;
    const scope = dash.ward ? active.filter((v) => v.ward_id === dash.ward) : active;
    const scopeName = dash.ward ? `Ward ${wardNumbers[dash.ward]}` : 'सभी Wards';
    const t = tally(scope);
    const root = h('div');

    if (dash.ward) {
      const back = h('button', 'back-link', '← सभी Wards');
      back.type = 'button';
      back.addEventListener('click', () => { dash.ward = null; renderDash(); });
      root.append(back);
    }
    root.append(h('h2', 'panel-title', scopeName), h('p', 'muted', `${t.total} active voters (मृत / shifted / duplicate शामिल नहीं)`));
    const rf = h('div', 'dash-refresh');
    const stampEl = h('span', 'muted', lastSync ? `अपडेट: ${lastSync}` : '');
    stampEl.id = 'dash-stamp';
    rf.append(linkBtn('↻ पूरा reload', () => document.dispatchEvent(new Event('voters-changed'))), stampEl);
    root.append(rf);

    const cards = h('div', 'dash-cards');
    SUP_KEYS.forEach((k) => {
      const c = h('button', `dash-card ${k}`);
      c.type = 'button';
      c.disabled = !t[k];
      c.append(h('div', 'dash-big', t[k]), h('div', 'dash-lbl', SUPPORT_LABEL[k]), h('div', 'dash-pct', pct(t[k], t.total)));
      c.addEventListener('click', () =>
        openList(`${scopeName} — ${SUPPORT_LABEL[k]}`, () => scope.filter((v) => v.is_active && supOf(v) === k)));
      cards.append(c);
    });
    root.append(cards, dashBar(t));

    const rest = h('div', 'dash-rest');
    ['undecided', 'unknown'].forEach((k) => {
      const b = linkBtn(`${SUPPORT_LABEL[k]}: ${t[k]}`, () =>
        openList(`${scopeName} — ${SUPPORT_LABEL[k]}`, () => scope.filter((v) => v.is_active && supOf(v) === k)));
      b.disabled = !t[k];
      rest.append(b);
    });
    root.append(rest);

    let rows;
    if (!dash.ward) {
      rows = [...groupBy(active, (v) => v.ward_id).entries()]
        .sort((a, b) => wardNumbers[a[0]] - wardNumbers[b[0]])
        .map(([id, vs]) => ({
          label: `Ward ${wardNumbers[id]}`, title: `Ward ${wardNumbers[id]}`, voters: vs,
          open: () => { dash.ward = id; renderDash(); window.scrollTo(0, 0); },
        }));
      rows.push({ label: 'कुल', title: 'सभी Wards', voters: active });
    } else {
      rows = [...groupBy(scope, (v) => v.locality || '').entries()]
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
        .map(([loc, vs]) => {
          const label = loc || '(locality खाली)';
          return { label, title: `${scopeName} · ${label}`, voters: vs };
        });
    }
    root.append(h('div', 'section-label', dash.ward ? 'Locality-wise' : 'Ward-wise'), statTable(dash.ward ? 'Locality' : 'Ward', rows));

    if (!dash.ward) {
      const msg = h('p', 'action-msg');
      const bk = h('button', 'visit-btn', '⬇ पूरा Backup (Excel)');
      bk.type = 'button';
      bk.addEventListener('click', () => runBackup(bk, msg));
      root.append(h('div', 'section-label', 'Backup'),
        h('p', 'muted', 'सभी voters + support level + History + Groups एक Excel में। हफ़्ते में एक बार लीजिए।'), bk, msg);
    }
    dashRoot.replaceChildren(root);
  }

  // ---------- Live sync (light: only new support/voted events, read-only) ----------
  let since = null;
  let syncing = false;
  let lastSync = '';
  const dashVisible = () => !document.getElementById('dashboard-tab').hidden && !appView.hidden;

  async function startSync() {
    const { data } = await sb.from('voter_events').select('created_at').order('created_at', { ascending: false }).limit(1);
    if (data) since = data[0] ? new Date(Date.parse(data[0].created_at) - 120000).toISOString() : '1970-01-01T00:00:00Z';
  }

  async function syncChanges() {
    if (syncing || !window.appUser || !window.appUser.isAdmin || !allVoters.length) return;
    syncing = true;
    try {
      if (!since) await startSync();
      if (!since) return;
      const evs = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from('voter_events').select('voter_id, event_type, new_value, created_at')
          .in('event_type', ['support_change', 'voted']).gte('created_at', since)
          .order('created_at').order('voter_id').range(from, from + 999);
        if (error) throw error;
        evs.push(...data);
        if (data.length < 1000) break;
      }
      const byId = new Map(allVoters.map((v) => [v.voter_id, v]));
      let changed = false;
      evs.forEach((ev) => {
        const v = byId.get(ev.voter_id);
        if (!v) return;
        if (ev.event_type === 'support_change' && v.support_level !== ev.new_value) { v.support_level = ev.new_value; changed = true; }
        if (ev.event_type === 'voted' && v.voted !== (ev.new_value === 'true')) { v.voted = ev.new_value === 'true'; changed = true; }
      });
      if (evs.length) since = new Date(Date.parse(evs[evs.length - 1].created_at) - 30000).toISOString();
      lastSync = new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
      if (changed) renderDash();
      const el = document.getElementById('dash-stamp');
      if (el) el.textContent = `अपडेट: ${lastSync}`;
    } catch (e) {
      console.warn('dashboard sync failed', e);
    } finally {
      syncing = false;
    }
  }

  // ---------- Wiring ----------
  document.addEventListener('user-ready', () => {
    dashTabBtn.hidden = !window.appUser.isAdmin;
    renderDash();
  });
  document.addEventListener('voters-loaded', () => { dash.list = null; renderDash(); startSync(); });
  document.addEventListener('detail-closed', () => { renderDash(); syncChanges(); });
  dashTabBtn.addEventListener('click', syncChanges);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && dashVisible()) syncChanges(); });
  setInterval(() => { if (!document.hidden && dashVisible()) syncChanges(); }, 30000);
  document.addEventListener('user-gone', () => {
    dash.ward = dash.list = null;
    since = null;
    lastSync = '';
    dashTabBtn.hidden = true;
    dashRoot.replaceChildren();
    document.querySelector('.tab-btn[data-tab="search-tab"]').click(); // don't leave a non-admin on this tab
  });
})();
