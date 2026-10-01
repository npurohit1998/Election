// Voter search + list + detail. Loads voters once per app view (cheap at
// 3,600 rows total across all wards eventually), filters client-side so
// search feels instant even with patchy signal at a door.

const searchInput = document.getElementById('voter-search');
const localityFilter = document.getElementById('locality-filter');
const voterListEl = document.getElementById('voter-list');
const voterCountEl = document.getElementById('voter-count');
const rowTemplate = document.getElementById('voter-row-template');
const detailView = document.getElementById('detail-view');
const voterDetailEl = document.getElementById('voter-detail');
const backBtn = document.getElementById('back-btn');
const detailUserName = document.getElementById('detail-user-name');

let allVoters = [];

const RELATION_LABEL = { father: "Father", husband: "Husband", other: "Relation" };
const GENDER_LABEL = { M: 'Male', F: 'Female', O: 'Other' };
const STATUS_LABEL = { E: 'Deceased', S: 'Shifted', R: 'Duplicate entry' };
const SUPPORT_LABEL = {
  strong_support: 'Strong support', leaning: 'Leaning',
  undecided: 'Undecided', opposition: 'Opposition', unknown: 'Not yet assessed'
};

async function loadVoters() {
  voterCountEl.textContent = 'Loading voters…';
  const { data, error } = await sb
    .from('voters')
    .select('*')
    .order('house_number', { ascending: true });

  if (error) {
    voterCountEl.textContent = `Couldn't load voters: ${error.message}`;
    return;
  }

  allVoters = data;
  populateLocalityFilter();
  renderList();
}

function populateLocalityFilter() {
  const localities = [...new Set(allVoters.map((v) => v.locality).filter(Boolean))].sort();
  localityFilter.innerHTML = '<option value="">All localities</option>' +
    localities.map((l) => `<option value="${l}">${l}</option>`).join('');
}

function matchesSearch(voter, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    (voter.name || '').toLowerCase().includes(q) ||
    (voter.relation_name || '').toLowerCase().includes(q) ||
    (voter.house_number || '').toLowerCase().includes(q) ||
    (voter.epic_number || '').toLowerCase().includes(q)
  );
}

function renderList() {
  const query = searchInput.value.trim();
  const locality = localityFilter.value;

  const filtered = allVoters.filter((v) =>
    v.is_active &&
    matchesSearch(v, query) &&
    (!locality || v.locality === locality)
  );

  voterCountEl.textContent = query || locality
    ? `${filtered.length} match${filtered.length === 1 ? '' : 'es'}`
    : `${filtered.length} active voters`;

  voterListEl.innerHTML = '';

  // Keep it light on screen until someone's actually searching/filtering —
  // scanning 352 rows by hand isn't the point of a search box.
  const toShow = (query || locality) ? filtered : filtered.slice(0, 30);

  for (const voter of toShow) {
    const node = rowTemplate.content.cloneNode(true);
    const img = node.querySelector('.voter-thumb');
    img.src = voter.photo_url
      ? `${SUPABASE_URL}/storage/v1/object/public/voters/${voter.photo_url}`
      : '';
    img.alt = voter.name || '';
    if (!voter.photo_url) img.classList.add('no-photo');

    node.querySelector('.voter-row-name').textContent = voter.name || '(name pending)';
    node.querySelector('.voter-row-meta').textContent =
      `House ${voter.house_number || '—'} · ${voter.age || '?'} yrs · ${GENDER_LABEL[voter.gender] || voter.gender || '—'}`;
    node.querySelector('.voter-row').addEventListener('click', () => showDetail(voter));
    voterListEl.appendChild(node);
  }

  if (!query && !locality && filtered.length > 30) {
    const more = document.createElement('p');
    more.className = 'list-hint';
    more.textContent = `Showing 30 of ${filtered.length} — search or filter by locality to narrow this down.`;
    voterListEl.appendChild(more);
  }
}

function showDetail(voter) {
  detailUserName.textContent = document.getElementById('user-name').textContent;
  appView.hidden = true;
  detailView.hidden = false;

  const photoUrl = voter.photo_url
    ? `${SUPABASE_URL}/storage/v1/object/public/voters/${voter.photo_url}`
    : null;

  voterDetailEl.innerHTML = `
    <div class="detail-card">
      ${photoUrl
        ? `<img class="detail-photo" src="${photoUrl}" alt="${voter.name || ''}">`
        : `<div class="detail-photo no-photo"></div>`}
      <h2>${voter.name || '(name pending)'}</h2>
      <p class="detail-sub">${RELATION_LABEL[voter.relation_type] || 'Relation'}: ${voter.relation_name || '—'}</p>

      ${voter.deletion_status
        ? `<p class="status-flag">${STATUS_LABEL[voter.deletion_status]}</p>`
        : ''}

      <dl class="detail-grid">
        <dt>House number</dt><dd>${voter.house_number || '—'}</dd>
        <dt>Age</dt><dd>${voter.age || '—'}</dd>
        <dt>Gender</dt><dd>${GENDER_LABEL[voter.gender] || voter.gender || '—'}</dd>
        <dt>Locality</dt><dd>${voter.locality || '—'}</dd>
        <dt>Voter ID</dt><dd>${voter.epic_number || '—'}</dd>
        <dt>Serial No.</dt><dd>${voter.serial_number || '—'}</dd>
      </dl>

      <div class="support-row">
        <span>Support level</span>
        <strong>${SUPPORT_LABEL[voter.support_level] || voter.support_level}</strong>
      </div>

      <p class="placeholder">
        Changing support level, logging a visit, and marking voted land in the
        next build.
      </p>
    </div>
  `;
}

backBtn.addEventListener('click', () => {
  detailView.hidden = true;
  appView.hidden = false;
});

searchInput.addEventListener('input', renderList);
localityFilter.addEventListener('change', renderList);

// Load voters once the person is actually signed in, not before.
sb.auth.onAuthStateChange((_event, session) => {
  if (session) loadVoters();
});
sb.auth.getSession().then(({ data: { session } }) => {
  if (session) loadVoters();
});
