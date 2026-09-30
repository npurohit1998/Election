// Imports a ward Excel file (produced by the PDF-extraction prompt) into
// Supabase. Expected columns, in order:
// Ward Number | Serial Number | Voter ID | Name | Relation Type |
// Relation Name | House Number | Age | Gender | Locality | Status |
// Photo Filename | Photo (embedded image)

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
  const { data: existing } = await supabase
    .from('wards')
    .select('ward_id')
    .eq('ward_number', wardNumber)
    .maybeSingle();

  if (existing) return existing.ward_id;

  const { data, error } = await supabase
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

    for (const row of dataRows) {
      const [
        , serialNumber, voterId, name, relationTypeRaw, relationName,
        houseNumber, age, genderRaw, locality, statusRaw, photoFilename
      ] = row;

      const gender = GENDER_MAP[(genderRaw || '').toLowerCase()] || null;
      const relationType = RELATION_MAP[(relationTypeRaw || '').toLowerCase()] || null;
      const deletionStatus = STATUS_MAP[(statusRaw || '').toLowerCase()] || null;

      let photoPath = null;
      // SheetJS doesn't expose embedded images directly; photos are matched
      // by the same row index against images pulled from the workbook zip.
      if (photoFilename) {
        try {
          const imgBlob = await extractEmbeddedImage(buffer, done);
          if (imgBlob) photoPath = await uploadPhoto(imgBlob, photoFilename);
        } catch (e) {
          photoFailures++;
        }
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
      (photoFailures ? `\n${photoFailures} photo(s) could not be read — those voters were saved without a photo, re-run to retry.` : ''),
      'success'
    );
  } catch (err) {
    setProgress(`Import failed: ${err.message}`, 'error');
  } finally {
    importBtn.disabled = false;
  }
});

// Pulls the Nth embedded image out of the raw .xlsx zip, in sheet order.
// (.xlsx is a zip of XML + media files; SheetJS's own API doesn't return
// embedded images, so we read the zip's xl/media folder directly.)
async function extractEmbeddedImage(arrayBuffer, index) {
  if (!window.__importZip) {
    window.__importZip = await JSZip.loadAsync(arrayBuffer);
  }
  const mediaFiles = Object.keys(window.__importZip.files)
    .filter((f) => f.startsWith('xl/media/'))
    .sort();
  const target = mediaFiles[index];
  if (!target) return null;
  return await window.__importZip.files[target].async('blob');
}
