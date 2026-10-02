// Imports a ward Excel file directly (no separate conversion step needed —
// works entirely in the browser, nothing to install).
//
// Photos are matched to rows using the .xlsx file's own internal XML, which
// records exactly which row each image is anchored to
// (xl/drawings/drawing1.xml + its .rels file). This is the same ground-truth
// data Excel itself uses to place images — not a guess about row/image
// ordering, which is what an earlier version of this file got wrong.

const GENDER_MAP = { male: 'M', female: 'F', other: 'O' };
const RELATION_MAP = { father: 'father', husband: 'husband', other: 'other' };
const STATUS_MAP = { deceased: 'E', shifted: 'S', duplicate: 'R' };

async function ensureWard(wardNumber) {
  const { data: existing } = await sb
    .from('wards')
    .select('ward_id')
    .eq('ward_number', wardNumber)
    .maybeSingle();

  if (existing) return existing.ward_id;

  const { data, error } = await sb
    .from('wards')
    .insert({ ward_number: wardNumber, gram_panchayat: 'लोर्डिया' })
    .select('ward_id')
    .single();

  if (error) throw error;
  return data.ward_id;
}

async function uploadPhoto(imageBlob, filename) {
  const path = `voter-photos/${filename}`;
  const { error } = await sb.storage
    .from('voters')
    .upload(path, imageBlob, { upsert: true, contentType: 'image/png' });
  if (error) throw error;
  return path;
}

// Reads the workbook's actual image-to-row mapping straight from its
// drawing XML — the same data Excel itself relies on, not an assumption.
async function buildRowToImageMap(zip) {
  const drawingFile = Object.keys(zip.files).find((f) => /xl\/drawings\/drawing\d+\.xml$/.test(f));
  if (!drawingFile) return new Map();

  const relsFile = drawingFile.replace('drawings/', 'drawings/_rels/') + '.rels';
  const [drawingXml, relsXml] = await Promise.all([
    zip.files[drawingFile].async('text'),
    zip.files[relsFile] ? zip.files[relsFile].async('text') : Promise.resolve(''),
  ]);

  // rId -> media filename, e.g. rId3 -> image3.png.
  // Attribute order in real XML isn't guaranteed (this file has Target
  // before Id), so match each attribute independently rather than assuming
  // a fixed order.
  const ridToFile = new Map();
  const relBlockRegex = /<Relationship\b[^>]*\/>/g;
  let relBlock;
  while ((relBlock = relBlockRegex.exec(relsXml))) {
    const tag = relBlock[0];
    const idMatch = tag.match(/\bId="(rId\d+)"/);
    const targetMatch = tag.match(/\bTarget="[^"]*\/(image\d+\.\w+)"/);
    if (idMatch && targetMatch) ridToFile.set(idMatch[1], targetMatch[1]);
  }

  // For each anchor block, pull its <row> and the r:embed rId inside it
  const rowToFile = new Map();
  const anchorRegex = /<(?:oneCellAnchor|twoCellAnchor)>([\s\S]*?)<\/(?:oneCellAnchor|twoCellAnchor)>/g;
  let anchor;
  while ((anchor = anchorRegex.exec(drawingXml))) {
    const block = anchor[1];
    const rowMatch = block.match(/<from>[\s\S]*?<row>(\d+)<\/row>/);
    const ridMatch = block.match(/r:embed="(rId\d+)"/);
    if (rowMatch && ridMatch) {
      const rowIndex = parseInt(rowMatch[1], 10); // 0-indexed, matches sheet row - 1
      const file = ridToFile.get(ridMatch[1]);
      if (file) rowToFile.set(rowIndex + 1, file); // convert to 1-indexed sheet row
    }
  }
  return rowToFile;
}

// ===== Per-ward import cards (Ward 1–9) =====
const WARD_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const wardListEl = document.getElementById('ward-import-list');
let importing = false;
let lastResult = null; // { ward, text, kind } — shown on that ward's card after refresh

function setStatus(el, text, kind) {
  el.textContent = text;
  el.className = 'ward-progress' + (kind ? ' ' + kind : '');
}

async function countVoters(wardId, withPhotoOnly) {
  let q = sb.from('voters').select('*', { count: 'exact', head: true }).eq('ward_id', wardId);
  if (withPhotoOnly) q = q.not('photo_url', 'is', null);
  const { count, error } = await q;
  if (error) throw error;
  return count || 0;
}

async function buildWardCard(n, wardId) {
  const card = document.createElement('div');
  card.className = 'ward-import';

  const title = document.createElement('div');
  title.className = 'ward-import-title';
  title.textContent = `Ward ${n}`;

  const summary = document.createElement('div');
  summary.className = 'ward-summary';
  let total = 0;
  try {
    if (wardId) {
      const [t, p] = await Promise.all([countVoters(wardId, false), countVoters(wardId, true)]);
      total = t;
      if (t) {
        summary.textContent = `✓ ${t} voters imported · photos ${p}/${t}`;
        summary.classList.add(p === t ? 'ok' : 'warn');
      }
    }
  } catch (e) {
    summary.textContent = `Couldn't check: ${e.message}`;
  }
  if (!summary.textContent) summary.textContent = 'Not imported yet';

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.xlsx';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = total ? 'Re-import (update)' : 'Import';

  const progress = document.createElement('div');
  progress.className = 'ward-progress';
  if (lastResult && lastResult.ward === n) setStatus(progress, lastResult.text, lastResult.kind);

  btn.addEventListener('click', () => runImport(n, total > 0, input, progress));
  card.append(title, summary, input, btn, progress);
  return card;
}

async function loadWardSummaries() {
  if (!wardListEl.children.length) wardListEl.textContent = 'Loading…';
  const { data: wards, error } = await sb.from('wards').select('ward_id, ward_number');
  if (error) {
    wardListEl.textContent = `Couldn't load wards: ${error.message}`;
    return;
  }
  const idByNumber = new Map((wards || []).map((w) => [Number(w.ward_number), w.ward_id]));
  const cards = await Promise.all(WARD_NUMBERS.map((n) => buildWardCard(n, idByNumber.get(n))));
  wardListEl.replaceChildren(...cards);
}

async function runImport(wardN, alreadyImported, input, progress) {
  if (importing) return;
  const file = input.files[0];
  if (!file) {
    setStatus(progress, 'Choose an Excel file first.', 'error');
    return;
  }
  if (alreadyImported && !confirm(`Ward ${wardN} already has data. Re-import and update it?`)) return;

  importing = true;
  wardListEl.querySelectorAll('button, input').forEach((e) => (e.disabled = true));
  lastResult = null;

  try {
    setStatus(progress, 'Reading file…');
    const buffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(buffer);
    const rowToImageFile = await buildRowToImageMap(zip);

    const workbook = XLSX.read(buffer, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
    const dataRows = rows.slice(1); // skip header row
    if (dataRows.length === 0) throw new Error('No data rows found in this file.');

    // Safety: the file's own ward column must match the ward card you used.
    const wrong = dataRows.find((r) => r[2] && Number(r[0]) !== wardN);
    if (wrong) {
      throw new Error(`This file contains Ward ${wrong[0]} rows, but you used the Ward ${wardN} box. Nothing was imported.`);
    }

    setStatus(progress, `Setting up Ward ${wardN}…`);
    const wardId = await ensureWard(wardN);

    let done = 0;
    let skipped = 0;
    let photoFailures = 0;
    let firstPhotoError = null;

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const [
        , serialNumber, voterId, name, relationTypeRaw, relationName,
        houseNumber, age, genderRaw, locality, statusRaw
      ] = row;

      if (!voterId) {
        if (row.some((c) => c !== null)) skipped++;
        continue;
      }

      const gender = GENDER_MAP[(genderRaw || '').toLowerCase()] || null;
      const relationType = RELATION_MAP[(relationTypeRaw || '').toLowerCase()] || null;
      const deletionStatus = STATUS_MAP[(statusRaw || '').toLowerCase()] || null;

      const sheetRow = i + 2; // header is row 1, data starts at row 2
      let photoPath = null;
      const imageFile = rowToImageFile.get(sheetRow);
      if (imageFile) {
        try {
          const imgBlob = await zip.files[`xl/media/${imageFile}`].async('blob');
          photoPath = await uploadPhoto(imgBlob, `${String(voterId).replace(/\//g, '_')}.png`);
        } catch (e) {
          photoFailures++;
          if (!firstPhotoError) firstPhotoError = `Row ${sheetRow} (${voterId}): ${e.message || e}`;
        }
      } else {
        photoFailures++;
        if (!firstPhotoError) firstPhotoError = `Row ${sheetRow} (${voterId}): no image found anchored to this row`;
      }

      const { error } = await sb.from('voters').upsert({
        ward_id: wardId,
        serial_number: serialNumber,
        epic_number: voterId,
        name,
        relation_type: relationType,
        relation_name: relationName,
        house_number: houseNumber ? String(houseNumber) : null,
        age,
        gender,
        locality,
        deletion_status: deletionStatus,
        photo_url: photoPath,
      }, { onConflict: 'epic_number' });
      if (error) throw error;

      done++;
      if (done % 25 === 0) setStatus(progress, `Imported ${done} / ${dataRows.length}…`);
    }

    lastResult = {
      ward: wardN,
      kind: photoFailures || skipped ? 'error' : 'success',
      text:
        `Done. Imported ${done} voters into Ward ${wardN}.` +
        (skipped ? `\n${skipped} row(s) skipped (no Voter ID).` : '') +
        (photoFailures
          ? `\n${photoFailures} photo(s) could not be uploaded.\nFirst error: ${firstPhotoError}`
          : '\nAll photos matched and uploaded correctly.'),
    };
  } catch (err) {
    lastResult = { ward: wardN, kind: 'error', text: `Import failed: ${err.message}` };
  } finally {
    importing = false;
  }

  await loadWardSummaries();
  document.dispatchEvent(new Event('voters-changed')); // refresh the Search tab's list
}

document.addEventListener('user-ready', () => {
  if (window.appUser && window.appUser.isAdmin) loadWardSummaries();
});
document.addEventListener('user-gone', () => {
  lastResult = null;
  wardListEl.replaceChildren();
});
