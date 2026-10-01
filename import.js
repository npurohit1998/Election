// Imports a ward Excel file directly (no separate conversion step needed —
// works entirely in the browser, nothing to install).
//
// Photos are matched to rows using the .xlsx file's own internal XML, which
// records exactly which row each image is anchored to
// (xl/drawings/drawing1.xml + its .rels file). This is the same ground-truth
// data Excel itself uses to place images — not a guess about row/image
// ordering, which is what an earlier version of this file got wrong.

const importFileInput = document.getElementById('import-file');
const importBtn = document.getElementById('import-btn');
const importProgress = document.getElementById('import-progress');

const GENDER_MAP = { male: 'M', female: 'F', other: 'O' };
const RELATION_MAP = { father: 'father', husband: 'husband', other: 'other' };
const STATUS_MAP = { deceased: 'E', shifted: 'S', duplicate: 'R' };

function setProgress(text, kind) {
  importProgress.textContent = text;
  importProgress.className = kind || '';
}

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

importBtn.addEventListener('click', async () => {
  const file = importFileInput.files[0];
  if (!file) {
    setProgress('Choose an Excel file first.', 'error');
    return;
  }

  importBtn.disabled = true;
  setProgress('Reading file…');

  try {
    const buffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(buffer);
    const rowToImageFile = await buildRowToImageMap(zip);

    const workbook = XLSX.read(buffer, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
    const dataRows = rows.slice(1); // skip header row

    if (dataRows.length === 0) {
      setProgress('No data rows found in this file.', 'error');
      importBtn.disabled = false;
      return;
    }

    const wardNumber = dataRows[0][0];
    setProgress(`Setting up Ward ${wardNumber}…`);
    const wardId = await ensureWard(wardNumber);

    let done = 0;
    let photoFailures = 0;

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const [
        , serialNumber, voterId, name, relationTypeRaw, relationName,
        houseNumber, age, genderRaw, locality, statusRaw
      ] = row;

      const gender = GENDER_MAP[(genderRaw || '').toLowerCase()] || null;
      const relationType = RELATION_MAP[(relationTypeRaw || '').toLowerCase()] || null;
      const deletionStatus = STATUS_MAP[(statusRaw || '').toLowerCase()] || null;

      const sheetRow = i + 2; // header is row 1, data starts at row 2
      let photoPath = null;
      const imageFile = rowToImageFile.get(sheetRow);
      if (imageFile) {
        try {
          const zipPath = `xl/media/${imageFile}`;
          const imgBlob = await zip.files[zipPath].async('blob');
          const safeName = `${(voterId || `row${sheetRow}`).replace(/\//g, '_')}.png`;
          photoPath = await uploadPhoto(imgBlob, safeName);
        } catch (e) {
          photoFailures++;
        }
      } else {
        photoFailures++;
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
      if (done % 25 === 0) setProgress(`Imported ${done} / ${dataRows.length}…`);
    }

    setProgress(
      `Done. Imported ${done} voters into Ward ${wardNumber}.` +
      (photoFailures ? `\n${photoFailures} photo(s) could not be matched — those voters were saved without one.` : '\nAll photos matched and uploaded correctly.'),
      'success'
    );
  } catch (err) {
    setProgress(`Import failed: ${err.message}`, 'error');
  } finally {
    importBtn.disabled = false;
  }
});
