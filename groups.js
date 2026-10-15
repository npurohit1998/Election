// Families (auto-grouped by house) and custom groups (your own criteria).
// Uses helpers from voters.js (h, allVoters, wardNumbers, showDetail, ...).

const familyMainEl = document.getElementById('family-main');
const familyDetailEl = document.getElementById('family-detail');
const familySearch = document.getElementById('family-search');
const familyCountEl = document.getElementById('family-count');
const familyListEl = document.getElementById('family-list');
const groupsMainEl = document.getElementById('groups-main');
const groupDetailEl = document.getElementById('group-detail');
const groupsListEl = document.getElementById('groups-list');

let groups = [];
let memberships = []; // { group_id, voter_id }
let openFamily = null;
let openGroup = null;

function memberRow(voter) {
  const node = rowTemplate.content.cloneNode(true);
  const img = node.querySelector('.voter-thumb');
  if (voter.photo_url) img.src = photoSrc(voter);
  else img.classList.add('no-photo');
  node.querySelector('.voter-row-name').textContent = voter.name || '(name pending)';
  node.querySelector('.voter-row-meta').textContent =
    `${voter.age || '?'} yrs · ${GENDER_LABEL[voter.gender] || '—'}${voter.voted ? ' · ✓ Voted' : ''}`;
  node.querySelector('.voter-row').addEventListener('click', () => showDetail(voter));
  return node;
}

function listOf(members) {
  const box = h('div', 'voter-list');
  members.forEach((m) => box.append(memberRow(m)));
  return box;
}

// ---------- Families: same ward + locality + house number ----------
function families() {
  const map = new Map();
  for (const v of allVoters) {
    if (!v.is_active) continue;
    const k = `${v.ward_id}|${v.locality || ''}|${v.house_number || ''}`;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(v);
  }
  return map;
}

function renderFamilies() {
  const map = families();
  const open = openFamily && map.get(openFamily);
  familyMainEl.hidden = !!open;
  familyDetailEl.hidden = !open;
  if (open) return renderHousehold(open);
  openFamily = null;

  const q = familySearch.value.trim().toLowerCase();
  const list = [...map.entries()]
    .map(([key, members]) => ({ key, members, v: members[0] }))
    .filter((f) => !q || [f.v.locality, f.v.house_number, ...f.members.flatMap((m) => [m.name, m.relation_name])]
      .join(' ').toLowerCase().includes(q))
    .sort((a, b) =>
      (wardNumbers[a.v.ward_id] - wardNumbers[b.v.ward_id]) ||
      String(a.v.locality || '').localeCompare(String(b.v.locality || '')) ||
      String(a.v.house_number || '').localeCompare(String(b.v.house_number || ''), undefined, { numeric: true }));

  familyCountEl.textContent = `${list.length} families (houses)`;
  familyListEl.replaceChildren();
  for (const f of list.slice(0, q ? 150 : 40)) {
    const b = h('button', 'voter-row');
    b.type = 'button';
    const info = h('div', 'voter-row-info');
    const names = f.members.slice(0, 3).map((m) => m.name).join(', ') +
      (f.members.length > 3 ? ` +${f.members.length - 3}` : '');
    info.append(
      h('div', 'voter-row-name', `House ${f.v.house_number || '—'} · ${f.members.length} voters`),
      h('div', 'voter-row-meta', `Ward ${wardNumbers[f.v.ward_id] || '?'} · ${f.v.locality || '—'}`),
      h('div', 'voter-row-meta', names)
    );
    b.append(info);
    b.addEventListener('click', () => { openFamily = f.key; renderFamilies(); });
    familyListEl.append(b);
  }
  if (!q && list.length > 40) {
    familyListEl.append(h('p', 'list-hint', `Showing 40 of ${list.length} — search to narrow this down.`));
  }
}

function renderHousehold(members) {
  const v = members[0];
  const back = h('button', 'back-link', '← All families');
  back.type = 'button';
  back.addEventListener('click', () => { openFamily = null; renderFamilies(); });
  const msg = h('p', 'action-msg');
  const add = h('button', 'visit-btn', 'Add surname to everyone');
  add.type = 'button';
  add.addEventListener('click', () => addSurname(members, msg));
  const pick = h('select', 'group-pick');
  pick.append(new Option('Group चुनिए…', ''), ...groups.map((g) => new Option(g.name, g.group_id)));
  const toGroup = h('button', 'visit-btn', 'सबको group में जोड़ें');
  toGroup.type = 'button';
  toGroup.addEventListener('click', async () => {
    const gid = Number(pick.value);
    const g = groups.find((x) => x.group_id === gid);
    if (!g) { msg.textContent = groups.length ? 'पहले group चुनिए।' : 'पहले Groups tab में group बनाइए।'; return; }
    if (!confirm(`इस घर के ${members.length} voters को "${g.name}" group में जोड़ें?`)) return;
    toGroup.disabled = true;
    await window.bulkGroupAdd(gid, members.map((m) => m.voter_id), msg);
    toGroup.disabled = false;
  });
  familyDetailEl.replaceChildren(
    back,
    h('h2', 'panel-title', `House ${v.house_number || '—'} · ${members.length} voters`),
    h('p', 'muted', `Ward ${wardNumbers[v.ward_id] || '?'} · ${v.locality || '—'}`),
    pick, toGroup, add, msg, listOf(members)
  );
}

async function addSurname(members, msg) {
  const s = (prompt('Surname to add after every name in this house (e.g. ओझा):') || '').trim();
  if (!s) return;
  let n = 0;
  for (const m of members) {
    n++;
    if ((m.name || '').trim().endsWith(s)) continue;
    msg.textContent = `Updating ${n} of ${members.length}…`;
    const { data, error } = await sb.rpc('voter_edit', {
      p_voter: m.voter_id, p_changes: { name: `${m.name || ''} ${s}`.trim() },
    });
    if (error) { msg.textContent = `Stopped: ${error.message}`; return; }
    Object.assign(m, data);
  }
  renderFamilies();
  familyDetailEl.querySelector('.action-msg').textContent = 'Done ✓';
}

// ---------- Custom groups ----------
async function loadGroups() {
  const { data: g } = await sb.from('groups').select('*').order('name');
  groups = g || [];
  memberships = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await sb.from('group_members').select('group_id, voter_id')
      .order('group_id').order('voter_id').range(from, from + 999);
    if (!data) break;
    memberships = memberships.concat(data);
    if (data.length < 1000) break;
  }
  renderGroups();
}

function renderGroups() {
  const g = openGroup && groups.find((x) => x.group_id === openGroup);
  groupsMainEl.hidden = !!g;
  groupDetailEl.hidden = !g;
  if (g) return renderGroupPage(g);
  openGroup = null;

  groupsListEl.replaceChildren();
  if (!groups.length) {
    groupsListEl.append(h('p', 'list-hint', 'No groups yet. Create one, e.g. "Youth" or "Needs transport".'));
  }
  groups.forEach((x) => {
    const n = memberships.filter((m) => m.group_id === x.group_id).length;
    const b = h('button', 'voter-row');
    b.type = 'button';
    const info = h('div', 'voter-row-info');
    info.append(h('div', 'voter-row-name', x.name), h('div', 'voter-row-meta', `${n} voter${n === 1 ? '' : 's'}`));
    b.append(info);
    b.addEventListener('click', () => { openGroup = x.group_id; renderGroups(); });
    groupsListEl.append(b);
  });
}

function renderGroupPage(g) {
  const byId = new Map(allVoters.map((v) => [v.voter_id, v]));
  const members = memberships.filter((m) => m.group_id === g.group_id)
    .map((m) => byId.get(m.voter_id)).filter(Boolean);

  const back = h('button', 'back-link', '← All groups');
  back.type = 'button';
  back.addEventListener('click', () => { openGroup = null; renderGroups(); });

  const del = h('button', 'danger-btn', 'Delete this group');
  del.type = 'button';
  del.addEventListener('click', async () => {
    if (!confirm(`Delete group "${g.name}"? Voters are kept; only the group is removed.`)) return;
    await sb.from('group_members').delete().eq('group_id', g.group_id);
    const { error } = await sb.from('groups').delete().eq('group_id', g.group_id);
    if (error) { alert(error.message); return; }
    openGroup = null;
    await loadGroups();
  });

  let printBtn = null;
  if (members.length) { // open to all volunteers
    printBtn = h('button', 'visit-btn', '📄 PDF / Print');
    printBtn.type = 'button';
    printBtn.addEventListener('click', () => printGroup(g, members));
  }

  groupDetailEl.replaceChildren(
    back,
    h('h2', 'panel-title', g.name),
    h('p', 'muted', `${members.length} voters. To add someone, open their page and use "Groups".`),
    ...(printBtn ? [printBtn, h('div', 'dash-gap')] : []),
    members.length ? listOf(members) : h('p', 'list-hint', 'No voters in this group yet.'),
    del
  );
}

document.getElementById('new-group-btn').addEventListener('click', async () => {
  const name = (prompt('Group name (e.g. Youth, Relatives, Needs transport):') || '').trim();
  if (!name) return;
  const { error } = await sb.from('groups').insert({ name, created_by: window.appUser.id });
  if (error) { alert(`Could not create group: ${error.message}`); return; }
  await loadGroups();
});

// Adds many voters to a group at once (skips existing members). Used by Families and Search "select" mode.
window.bulkGroupAdd = async (groupId, voterIds, msgEl) => {
  const g = groups.find((x) => x.group_id === groupId);
  const have = new Set(memberships.filter((m) => m.group_id === groupId).map((m) => m.voter_id));
  const ids = [...new Set(voterIds)];
  const fresh = ids.filter((id) => !have.has(id));
  const added = [];
  let failed = '';
  for (let i = 0; i < fresh.length && !failed; i += 200) {
    const rows = fresh.slice(i, i + 200).map((id) => ({ group_id: groupId, voter_id: id, added_by: window.appUser.id }));
    msgEl.textContent = `जोड़ा जा रहा है… ${added.length}/${fresh.length}`;
    const { error } = await sb.from('group_members').insert(rows);
    if (!error) { added.push(...rows.map((r) => r.voter_id)); continue; }
    if (error.code !== '23505') { failed = error.message; break; }
    for (const r of rows) { // a few were added meanwhile: retry one by one
      const { error: e1 } = await sb.from('group_members').insert(r);
      if (!e1) added.push(r.voter_id);
      else if (e1.code !== '23505') { failed = e1.message; break; }
    }
  }
  added.forEach((id) => memberships.push({ group_id: groupId, voter_id: id }));
  renderGroups();
  msgEl.textContent = failed
    ? `${added.length} जुड़े, फिर रुक गया: ${failed}`
    : `${added.length} जुड़े, ${ids.length - added.length} पहले से "${g ? g.name : ''}" में थे।`;
  if (added.length) msgEl.append(undoButton(groupId, added, msgEl));
  return added;
};

// Removes only the voters added by the last bulk add (group membership only; voters are untouched).
function undoButton(groupId, added, msgEl) {
  const b = h('button', 'back-link', '↩ पलटें');
  b.type = 'button';
  b.addEventListener('click', async () => {
    b.disabled = true;
    for (let i = 0; i < added.length; i += 50) {
      const { error } = await sb.from('group_members').delete().eq('group_id', groupId).in('voter_id', added.slice(i, i + 50));
      if (error) { msgEl.textContent = `पलट नहीं सका: ${error.message}`; return; }
    }
    const gone = new Set(added);
    memberships = memberships.filter((m) => !(m.group_id === groupId && gone.has(m.voter_id)));
    renderGroups();
    msgEl.textContent = 'पलट दिया ✓';
  });
  return b;
}

// Clean A4 list of a group -> browser "Print / Save as PDF" (Hindi prints correctly this way).
function printGroup(g, members) {
  const withPhone = confirm('PDF में मोबाइल नंबर शामिल करें?\n\nOK = हाँ, Cancel = नहीं');
  const list = members.filter((v) => v.is_active).sort((a, b) =>
    (wardNumbers[a.ward_id] - wardNumbers[b.ward_id]) ||
    String(a.locality || '').localeCompare(String(b.locality || '')) ||
    String(a.house_number || '').localeCompare(String(b.house_number || ''), undefined, { numeric: true }));

  const old = document.getElementById('print-area');
  if (old) old.remove();
  const area = h('div');
  area.id = 'print-area';
  const date = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  area.append(
    h('h1', null, `${g.name} — ${list.length} voters`),
    h('p', 'print-note', `${date} · सिर्फ़ चुनाव कार्य हेतु — गोपनीय, आगे साझा न करें`));

  const head = h('tr');
  ['क्रम', 'नाम', 'पिता / पति', 'मकान', 'Locality', 'Ward', ...(withPhone ? ['मोबाइल'] : []), 'नोट']
    .forEach((t) => head.append(h('th', null, t)));
  const thead = h('thead');
  thead.append(head);
  const tbody = h('tbody');
  list.forEach((v, i) => {
    const tr = h('tr');
    [i + 1, v.name || '', v.relation_name || '', v.house_number || '', v.locality || '', wardNumbers[v.ward_id] || '',
      ...(withPhone ? [normPhone(v.phone) || '—'] : []), '']
      .forEach((t) => tr.append(h('td', null, t)));
    tbody.append(tr);
  });
  const table = h('table');
  table.append(thead, tbody);
  area.append(table);
  document.body.append(area);

  const done = () => { area.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
}

// Shown inside each voter's page (called from voters.js).
window.groupSection = (voter) => {
  const box = h('div');
  box.append(h('div', 'section-label', 'Groups'));
  const mine = new Set(memberships.filter((m) => m.voter_id === voter.voter_id).map((m) => m.group_id));
  const chips = h('div', 'chips');
  groups.filter((g) => mine.has(g.group_id)).forEach((g) => {
    const c = h('button', 'chip', `${g.name} ✕`);
    c.type = 'button';
    c.addEventListener('click', () => changeMembership(voter, g.group_id, false));
    chips.append(c);
  });
  if (!mine.size) chips.append(h('span', 'muted', groups.length ? 'Not in any group' : 'No groups created yet (Groups tab)'));
  box.append(chips);

  const rest = groups.filter((g) => !mine.has(g.group_id));
  if (rest.length) {
    const sel = h('select');
    sel.append(new Option('Add to group…', ''), ...rest.map((g) => new Option(g.name, g.group_id)));
    sel.addEventListener('change', () => sel.value && changeMembership(voter, Number(sel.value), true));
    box.append(sel);
  }
  return box;
};

async function changeMembership(voter, groupId, add) {
  const { error } = add
    ? await sb.from('group_members').insert({ group_id: groupId, voter_id: voter.voter_id, added_by: window.appUser.id })
    : await sb.from('group_members').delete().eq('group_id', groupId).eq('voter_id', voter.voter_id);
  if (error && error.code !== '23505') { alert(`Could not save: ${error.message}`); return; }
  memberships = memberships.filter((m) => !(m.group_id === groupId && m.voter_id === voter.voter_id));
  if (add) memberships.push({ group_id: groupId, voter_id: voter.voter_id });
  renderDetail();
  renderGroups();
}

familySearch.addEventListener('input', debounce(renderFamilies, 150));
document.addEventListener('voters-loaded', renderFamilies);
document.addEventListener('detail-closed', () => { renderFamilies(); renderGroups(); });
document.addEventListener('user-ready', loadGroups);
document.addEventListener('user-gone', () => {
  groups = [];
  memberships = [];
  openFamily = openGroup = null;
  [familyListEl, familyDetailEl, groupsListEl, groupDetailEl].forEach((e) => e.replaceChildren());
});