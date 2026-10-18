// Voter search, list and detail — with support level, visit log, voted mark.
// All text is inserted with textContent (never innerHTML), so odd characters
// in names can't break the page.

const searchInput = document.getElementById('voter-search');
const localityFilter = document.getElementById('locality-filter');
const wardFilter = document.getElementById('ward-filter');
const voterListEl = document.getElementById('voter-list');
const voterCountEl = document.getElementById('voter-count');
const rowTemplate = document.getElementById('voter-row-template');
const detailView = document.getElementById('detail-view');
const voterDetailEl = document.getElementById('voter-detail');
const backBtn = document.getElementById('back-btn');
const detailUserName = document.getElementById('detail-user-name');

let allVoters = [];
let currentVoter = null;
let names = {}; // user_id -> display name
let wardNumbers = {}; // ward_id -> ward number
let savedScroll = 0;

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

const RELATION_LABEL = { father: 'Father', husband: 'Husband', other: 'Relation' };
const GENDER_LABEL = { M: 'Male', F: 'Female', O: 'Other' };
const STATUS_LABEL = { E: 'Deceased', S: 'Shifted', R: 'Duplicate entry' };
const SUPPORT_LABEL = {
  strong_support: 'Strong support', leaning: 'Leaning',
  undecided: 'Undecided', opposition: 'Opposition', unknown: 'Not yet assessed',
};
const SUPPORT_ORDER = ['strong_support', 'leaning', 'undecided', 'opposition', 'unknown'];
const EDIT_FIELDS = [
  ['name', 'Name'], ['relation_type', 'Relation', 'select', RELATION_LABEL],
  ['relation_name', 'Relation name'], ['house_number', 'House number'],
  ['age', 'Age', 'number'], ['gender', 'Gender', 'select', GENDER_LABEL],
  ['locality', 'Locality'], ['phone', 'Mobile number', 'tel'], ['epic_number', 'Voter ID (EPIC)'],
];
const FIELD_LABEL = Object.fromEntries(EDIT_FIELDS.map(([k, l]) => [k, l]));

function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// Voters with no EPIC are stored under a made-up NOEPIC-… key; show that nicely.
function realEpic(v) {
  return v.epic_number && !v.epic_number.startsWith('NOEPIC-') ? v.epic_number : '';
}
// Indian mobile: keeps 10 digits (drops +91 / leading 0); '' if invalid.
function normPhone(s) {
  let d = String(s || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : '';
}

// WhatsApp का तैयार संदेश (volunteer को सिर्फ़ Send दबाना होता है). बदलना हो तो सिर्फ़ यह text बदलिए.
const WA_MESSAGE =
  'नमस्कार, मैं भीमराज पुरोहित आपके सहयोग व विश्वास के बलबूते 24 अक्टूबर 2026 को होने जा रहे लोर्डियाँ गाँव के सरपंच पद के प्रत्याशी के रूप में खड़ा हूँ ।\n' +
  '24 अक्टूबर को मतदान कर मुझे विजयी बनाने में आपका सहयोग परम आवश्यक है ।';

// Mobile number + Call / WhatsApp buttons. Every tap is logged (who + when),
// so all volunteers can see it in History.
function phoneBlock(v, onLogged) {
  const box = h('div', 'phone-box');
  box.append(h('div', 'section-label', 'Mobile'));
  const num = normPhone(v.phone);
  if (!num) {
    box.append(h('p', 'muted', 'नंबर नहीं जुड़ा — "✎ Edit details" से जोड़ें।'));
    return box;
  }
  const msg = h('p', 'action-msg');
  const row = contactLinks(v, num, { cls: 'phone-actions', onLogged, onError: (m) => { msg.textContent = m; } });
  box.append(h('div', 'phone-num', num), row, msg, h('div', 'last-contact'));
  return box;
}

function shownEpic(v) {
  return realEpic(v) || 'No EPIC yet';
}

function photoSrc(v) {
  return `${SUPABASE_URL}/storage/v1/object/public/voters/${v.photo_url}`;
}

async function loadVoters() {
  voterCountEl.textContent = 'Loading voters…';
  let rows = [];
  // Supabase returns max 1000 rows per request, so fetch in pages.
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('voters').select('*')
      .order('house_number').order('voter_id').range(from, from + 999);
    if (error) {
      voterCountEl.textContent = `Couldn't load voters: ${error.message}`;
      return;
    }
    rows = rows.concat(data);
    if (data.length < 1000) break;
  }
  allVoters = rows;

  const { data: profs } = await sb.from('profiles').select('user_id, display_name');
  names = Object.fromEntries((profs || []).map((p) => [p.user_id, p.display_name]));

  const { data: wards } = await sb.from('wards').select('ward_id, ward_number');
  wardNumbers = Object.fromEntries((wards || []).map((w) => [w.ward_id, w.ward_number]));

  const present = [...new Set(allVoters.map((v) => v.ward_id))]
    .sort((a, b) => wardNumbers[a] - wardNumbers[b]);
  const chosenWard = wardFilter.value;
  wardFilter.replaceChildren(
    new Option('All wards', ''),
    ...present.map((id) => new Option(`Ward ${wardNumbers[id]}`, String(id)))
  );
  wardFilter.value = chosenWard;
  populateLocalities();
  renderList();
  document.dispatchEvent(new Event('voters-loaded'));
}

// Locality choices follow the selected ward.
function populateLocalities() {
  const inWard = allVoters.filter((v) => !wardFilter.value || String(v.ward_id) === wardFilter.value);
  const localities = [...new Set(inWard.map((v) => v.locality).filter(Boolean))].sort();
  localityFilter.replaceChildren(
    new Option('All localities', ''),
    ...localities.map((l) => new Option(l, l))
  );
}

function matchesSearch(voter, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    (voter.name || '').toLowerCase().includes(q) ||
    (voter.relation_name || '').toLowerCase().includes(q) ||
    (voter.house_number || '').toLowerCase().includes(q) ||
    (voter.epic_number || '').toLowerCase().includes(q) ||
    (voter.phone || '').includes(q)
  );
}

// ---------- Multi-select: add many voters to a group ----------
const $id = (id) => document.getElementById(id);
const MAX_SELECT = 500;
const PAGE_SIZE = 50; // एक बार में इतने voters दिखते हैं; "और दिखाएँ" दबाने पर इतने और जुड़ते हैं
let shownLimit = PAGE_SIZE;
function resetPaging() { shownLimit = PAGE_SIZE; }

// Voters को ward -> serial number (संख्या के हिसाब से: 2, 10, 100) के क्रम में लगाता है.
// यह सिर्फ़ दिखाने का क्रम बदलता है, डेटा में कोई बदलाव नहीं करता.
const numOr = (x) => { const n = parseFloat(x); return Number.isFinite(n) ? n : Infinity; };
const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
function bySerial(a, b) {
  return cmp(numOr(wardNumbers[a.ward_id]), numOr(wardNumbers[b.ward_id]))
    || cmp(numOr(a.serial_number), numOr(b.serial_number))
    || cmp(a.voter_id, b.voter_id);
}
let selectMode = false;
let selected = new Set();
let lastFiltered = [];

function updateSelectBar() {
  const c = $id('select-count');
  if (c) c.textContent = `${selected.size} चुने गए`;
}

function fillSelectGroups() {
  const sel = $id('select-group');
  if (!sel) return;
  sel.replaceChildren(
    new Option(groups.length ? 'Group चुनिए…' : 'पहले Groups tab में group बनाइए', ''),
    ...groups.map((g) => new Option(g.name, g.group_id)));
}

function setSelectMode(on) {
  selectMode = on;
  if (!on) selected = new Set();
  const bar = $id('select-bar');
  const tog = $id('select-toggle');
  if (bar) bar.hidden = !on;
  if (tog) tog.textContent = on ? '✕ चुनना बंद करें' : '☑ कई लोगों को चुनें';
  $id('search-tab').classList.toggle('selecting', on);
  const m = $id('select-msg');
  if (m && !on) m.textContent = '';
  fillSelectGroups();
  updateSelectBar();
  renderList();
}

function toggleSelect(id, row) {
  if (selected.has(id)) selected.delete(id);
  else if (selected.size >= MAX_SELECT) {
    const m = $id('select-msg');
    if (m) m.textContent = `एक बार में अधिकतम ${MAX_SELECT} चुन सकते हैं।`;
    return;
  } else selected.add(id);
  const on = selected.has(id);
  const chk = row.querySelector('.row-check');
  if (chk) { chk.classList.toggle('on', on); chk.textContent = on ? '✓' : ''; }
  updateSelectBar();
}

// 📞 / 💬 links. Every tap is logged (who + when) so everyone can see it in History.
function contactLinks(v, num, { cls, short, onLogged, onError }) {
  const wrap = h('div', cls);
  [['call', '📞', 'Call', `tel:+91${num}`],
   ['whatsapp', '💬', 'WhatsApp', `https://wa.me/91${num}?text=${encodeURIComponent(WA_MESSAGE)}`]
  ].forEach(([type, icon, name, href]) => {
    const a = h('a', `phone-btn ${type}`, short ? icon : `${icon} ${name}`);
    a.href = href;
    a.setAttribute('aria-label', name);
    if (type === 'whatsapp') { a.target = '_blank'; a.rel = 'noopener'; }
    a.addEventListener('click', async (e) => {
      e.stopPropagation(); // don't open the voter page
      const { error } = await sb.rpc('voter_contact', { p_voter: v.voter_id, p_channel: type });
      if (error) onError(`Log नहीं हुआ: ${error.message}`);
      else if (onLogged) onLogged();
    });
    wrap.append(a);
  });
  return wrap;
}

function renderList() {
  const query = searchInput.value.trim();
  const locality = localityFilter.value;
  const ward = wardFilter.value;
  const pf = ($id('phone-filter') || {}).value || ''; // '', 'with', 'without'
  const searching = query || locality || ward || pf;

  const filtered = allVoters.filter((v) =>
    v.is_active && matchesSearch(v, query) && (!locality || v.locality === locality) &&
    (!ward || String(v.ward_id) === ward) &&
    (!pf || (pf === 'with') === !!normPhone(v.phone))
  ).sort(bySerial); // filter() नई list देता है, इसलिए allVoters का क्रम/डेटा जैसा था वैसा ही रहता है
  lastFiltered = filtered;
  const withNum = filtered.filter((v) => normPhone(v.phone)).length;

  voterCountEl.textContent = searching
    ? `${filtered.length} मिले · ${withNum} के पास नंबर`
    : `${filtered.length} active voters · ${withNum} के पास नंबर`;

  voterListEl.replaceChildren();

  const shown = filtered.slice(0, shownLimit);
  for (const voter of shown) {
    const node = rowTemplate.content.cloneNode(true);
    const row = node.querySelector('.voter-row');
    const img = node.querySelector('.voter-thumb');
    if (voter.photo_url) img.src = photoSrc(voter);
    else img.classList.add('no-photo');
    img.alt = voter.name || '';

    node.querySelector('.voter-row-name').textContent = voter.name || '(name pending)';
    node.querySelector('.voter-row-meta').textContent =
      `Ward ${wardNumbers[voter.ward_id] || '?'} · House ${voter.house_number || '—'} · ${voter.age || '?'} yrs · ${GENDER_LABEL[voter.gender] || voter.gender || '—'}` +
      (voter.voted ? ' · ✓ Voted' : '');

    if (selectMode) {
      const on = selected.has(voter.voter_id);
      row.prepend(h('span', `row-check${on ? ' on' : ''}`, on ? '✓' : ''));
    }
    row.addEventListener('click', () => {
      if (selectMode) toggleSelect(voter.voter_id, row);
      else showDetail(voter);
    });
    const num = normPhone(voter.phone);
    if (num && !selectMode) {
      row.append(contactLinks(voter, num, { cls: 'row-actions', short: true, onError: (m) => alert(m) }));
    }
    voterListEl.appendChild(node);
  }

  if (!filtered.length) {
    voterListEl.appendChild(h('p', 'list-hint', 'कोई voter नहीं मिला।'));
  } else {
    voterListEl.appendChild(h('p', 'list-hint', `${shown.length} / ${filtered.length} दिखाए गए (serial number के क्रम में)`));
    if (filtered.length > shown.length) {
      const more = h('button', 'visit-btn', `और दिखाएँ (${Math.min(PAGE_SIZE, filtered.length - shown.length)} और)`);
      more.type = 'button';
      more.addEventListener('click', () => { shownLimit += PAGE_SIZE; renderList(); });
      voterListEl.appendChild(more);
    }
  }
}

function showDetail(voter) {
  savedScroll = window.scrollY;
  if (!currentVoter) history.pushState({ detail: true }, ''); // phone Back button closes the voter page
  currentVoter = voter;
  detailUserName.textContent = window.appUser ? window.appUser.name : '';
  appView.hidden = true;
  detailView.hidden = false;
  window.scrollTo(0, 0);
  renderDetail();
}

function renderDetail() {
  const v = currentVoter;
  const card = h('div', 'detail-card');

  if (v.photo_url) {
    const img = h('img', 'detail-photo');
    img.src = photoSrc(v);
    img.alt = v.name || '';
    card.append(img);
  } else {
    card.append(h('div', 'detail-photo no-photo'));
  }

  card.append(
    h('h2', null, v.name || '(name pending)'),
    h('p', 'detail-sub', `${RELATION_LABEL[v.relation_type] || 'Relation'}: ${v.relation_name || '—'}`)
  );
  if (v.deletion_status) card.append(h('p', 'status-flag', STATUS_LABEL[v.deletion_status]));
  const editBtn = h('button', 'edit-btn', '✎ Edit details');
  editBtn.type = 'button';
  editBtn.addEventListener('click', renderEdit);
  card.append(editBtn);

  const dl = h('dl', 'detail-grid');
  [
    ['Ward', wardNumbers[v.ward_id]], ['House number', v.house_number], ['Age', v.age],
    ['Gender', GENDER_LABEL[v.gender] || v.gender], ['Locality', v.locality],
    ['Voter ID', shownEpic(v)], ['Serial No.', v.serial_number],
  ].forEach(([k, val]) => dl.append(h('dt', null, k), h('dd', null, val || '—')));
  card.append(dl);

  card.append(phoneBlock(v, () => loadHistory(hist)));

  // Support level
  card.append(h('div', 'section-label', 'Support level'));
  const seg = h('div', 'seg');
  SUPPORT_ORDER.forEach((key) => {
    const b = h('button', 'seg-btn' + (v.support_level === key ? ' on' : ''), SUPPORT_LABEL[key]);
    b.type = 'button';
    b.addEventListener('click', () => {
      if (v.support_level !== key) act('support_change', key, null);
    });
    seg.append(b);
  });
  card.append(seg);

  // Voted
  const votedBtn = h('button', 'voted-btn' + (v.voted ? ' on' : ''),
    v.voted ? '✓ Voted — tap to undo' : 'Mark as voted');
  votedBtn.type = 'button';
  votedBtn.addEventListener('click', () => act('voted', String(!v.voted), null));
  card.append(votedBtn);

  // Visit log
  card.append(h('div', 'section-label', 'Log a visit'));
  const note = h('textarea');
  note.id = 'visit-note';
  note.rows = 2;
  note.placeholder = 'Note (optional) — what did they say?';
  const visitBtn = h('button', 'visit-btn', 'Save visit');
  visitBtn.type = 'button';
  visitBtn.addEventListener('click', () => act('visit', null, note.value, true));
  card.append(note, visitBtn, h('p', 'action-msg'));

  if (window.groupSection) card.append(window.groupSection(v));
  if (window.meetingSection) card.append(window.meetingSection(v));

  // History
  card.append(h('div', 'section-label', 'History'));
  const hist = h('div', 'history');
  card.append(hist);

  voterDetailEl.replaceChildren(card);
  loadHistory(hist);
}

function renderEdit() {
  const v = currentVoter;
  const card = h('div', 'detail-card');
  card.append(h('h2', null, 'Edit voter'), h('p', 'detail-sub', 'Every change is saved in History with your name.'));
  const inputs = {};
  const initial = {};
  EDIT_FIELDS.forEach(([key, label, kind, opts]) => {
    const wrap = h('label', 'edit-field', label);
    let el;
    if (kind === 'select') {
      el = h('select');
      el.append(new Option('—', ''), ...Object.entries(opts).map(([k, t]) => new Option(t, k)));
    } else {
      el = h('input');
      el.type = kind || 'text';
      if (key === 'locality') el.setAttribute('list', 'locality-options');
      if (key === 'phone') { el.placeholder = '10 अंक, जैसे 9876543210'; el.inputMode = 'numeric'; }
    }
    el.value = key === 'epic_number' ? realEpic(v) : (v[key] == null ? '' : String(v[key]));
    initial[key] = el.value;
    inputs[key] = el;
    wrap.append(el);
    card.append(wrap);
  });
  const dl = h('datalist');
  dl.id = 'locality-options';
  [...new Set(allVoters.map((x) => x.locality).filter(Boolean))].sort().forEach((l) => dl.append(new Option(l)));

  const save = h('button', 'visit-btn', 'Save changes');
  const cancel = h('button', 'cancel-btn', 'Cancel');
  const msg = h('p', 'action-msg');
  save.type = cancel.type = 'button';
  cancel.addEventListener('click', renderDetail);
  save.addEventListener('click', async () => {
    const changes = {};
    for (const key of Object.keys(inputs)) {
      let val = inputs[key].value.trim();
      if (key === 'phone' && val) {
        val = normPhone(val);
        if (!val) { msg.textContent = 'Mobile number सही नहीं — 10 अंक चाहिए (6–9 से शुरू)।'; return; }
      }
      if (val !== initial[key] && !(key === 'epic_number' && !val)) changes[key] = val;
    }
    if (!Object.keys(changes).length) { renderDetail(); return; }
    save.disabled = cancel.disabled = true;
    msg.textContent = 'Saving…';
    const { data, error } = await sb.rpc('voter_edit', { p_voter: v.voter_id, p_changes: changes });
    if (error) {
      save.disabled = cancel.disabled = false;
      msg.textContent = `Could not save: ${error.message}`;
      return;
    }
    Object.assign(v, data);
    renderDetail();
    voterDetailEl.querySelector('.action-msg').textContent = 'Saved ✓';
  });
  card.append(dl, save, cancel, msg);
  voterDetailEl.replaceChildren(card);
  window.scrollTo(0, 0);
}

async function act(type, value, note, keepNote) {
  const msg = voterDetailEl.querySelector('.action-msg');
  const buttons = voterDetailEl.querySelectorAll('button');
  buttons.forEach((b) => (b.disabled = true));
  msg.textContent = 'Saving…';

  const { data, error } = await sb.rpc('voter_action', {
    p_voter: currentVoter.voter_id, p_type: type, p_value: value, p_note: note,
  });

  if (error) {
    buttons.forEach((b) => (b.disabled = false)); // keep typed note, let them retry
    msg.textContent = `Could not save: ${error.message}`;
    return;
  }
  Object.assign(currentVoter, data); // same object as in allVoters, so list updates too
  renderDetail();
  voterDetailEl.querySelector('.action-msg').textContent = 'Saved ✓';
}

function describeEvent(ev) {
  if (ev.event_type === 'edit') {
    return `Edited ${FIELD_LABEL[ev.note] || ev.note}: ${ev.old_value || '—'} → ${ev.new_value || '—'}`;
  }
  if (ev.event_type === 'support_change') {
    return `Support: ${SUPPORT_LABEL[ev.old_value] || ev.old_value || '—'} → ${SUPPORT_LABEL[ev.new_value] || ev.new_value}`;
  }
  if (ev.event_type === 'voted') return ev.new_value === 'true' ? 'Marked as voted' : 'Voted mark removed';
  if (ev.event_type === 'call') return '📞 Call किया';
  if (ev.event_type === 'whatsapp') return '💬 WhatsApp खोला';
  return 'Visit';
}

async function loadHistory(box) {
  box.textContent = 'Loading…';
  const { data, error } = await sb.from('voter_events').select('*')
    .eq('voter_id', currentVoter.voter_id).order('created_at', { ascending: false });
  if (error) { box.textContent = `Couldn't load history: ${error.message}`; return; }
  if (!data.length) { box.textContent = 'Nothing logged yet.'; return; }
  const lc = voterDetailEl.querySelector('.last-contact');
  const lastC = data.find((ev) => ev.event_type === 'call' || ev.event_type === 'whatsapp');
  if (lc && lastC) {
    const t = new Date(lastC.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    lc.textContent = `आख़िरी संपर्क: ${describeEvent(lastC)} — ${names[lastC.user_id] || 'Someone'}, ${t}`;
  }

  box.replaceChildren(...data.map((ev) => {
    const item = h('div', 'history-item');
    item.append(h('div', null, describeEvent(ev)));
    if (ev.note && ev.event_type !== 'edit') item.append(h('div', 'note', ev.note));
    const when = new Date(ev.created_at).toLocaleString('en-IN',
      { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    item.append(h('div', 'when', `${names[ev.user_id] || 'Someone'} · ${when}`));
    return item;
  }));
}

function closeDetail() {
  if (!currentVoter) return;
  detailView.hidden = true;
  appView.hidden = false;
  currentVoter = null;
  renderList();
  document.dispatchEvent(new Event('detail-closed'));
  window.scrollTo(0, savedScroll);
}

backBtn.addEventListener('click', () => history.back());
window.addEventListener('popstate', closeDetail);

searchInput.addEventListener('input', debounce(() => { resetPaging(); renderList(); }, 150));
wardFilter.addEventListener('change', () => { populateLocalities(); resetPaging(); renderList(); });
localityFilter.addEventListener('change', () => { resetPaging(); renderList(); });
if ($id('phone-filter')) $id('phone-filter').addEventListener('change', () => { resetPaging(); renderList(); });
if ($id('select-toggle')) {
  $id('select-toggle').addEventListener('click', () => setSelectMode(!selectMode));
  $id('select-all').addEventListener('click', () => {
    selected = new Set(lastFiltered.slice(0, MAX_SELECT).map((v) => v.voter_id));
    $id('select-msg').textContent = lastFiltered.length > MAX_SELECT
      ? `पहले ${MAX_SELECT} चुने गए — filter कसकर बाकी चुनिए।` : '';
    updateSelectBar();
    renderList();
  });
  $id('select-clear').addEventListener('click', () => { selected = new Set(); updateSelectBar(); renderList(); });
  $id('select-add').addEventListener('click', async () => {
    const msg = $id('select-msg');
    const gid = Number($id('select-group').value);
    const g = groups.find((x) => x.group_id === gid);
    if (!g) { msg.textContent = groups.length ? 'पहले group चुनिए।' : 'पहले Groups tab में group बनाइए।'; return; }
    if (!selected.size) { msg.textContent = 'पहले कुछ voters चुनिए।'; return; }
    if (!window.bulkGroupAdd) { msg.textContent = 'groups.js अपडेट नहीं हुई — सभी files साथ में बदलिए।'; return; }
    if (!confirm(`${selected.size} voters को "${g.name}" group में जोड़ें?`)) return;
    const btn = $id('select-add');
    btn.disabled = true;
    await window.bulkGroupAdd(gid, [...selected], msg);
    btn.disabled = false;
    selected = new Set();
    updateSelectBar();
    renderList();
  });
}
document.addEventListener('voters-changed', loadVoters);

document.addEventListener('user-ready', loadVoters);
document.addEventListener('user-gone', () => {
  selectMode = false;
  selected = new Set();
  if ($id('select-bar')) $id('select-bar').hidden = true;
  allVoters = [];
  resetPaging();
  wardFilter.value = '';
  currentVoter = null;
  voterListEl.replaceChildren();
  voterCountEl.textContent = '';
  voterDetailEl.replaceChildren();
});
