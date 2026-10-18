// 📄 मुलाकात की PDF सूची — volunteer को छपी हुई सूची दे सकें: "इनसे मिल लो और ☐ में ✓ कर लो".
// हर कोई बना सकता है. browser के Print → "Save as PDF" से बनती है (देवनागरी इसी तरह सही छपती है),
// ठीक उसी तरह जैसे Group की PDF. सारे नियम/क्रम meetings.js के साथ एक जैसे हैं (Ward → Locality → मकान → Serial).
// meetings.js इसका panel मुलाकात टैब में जोड़ती है (window.meetReportPanel).
(() => {
  const ROWS_PER_PAGE = 28; // पन्नों का अंदाज़ा लगाने के लिए
  const REL = { father: 'पिता', husband: 'पति', other: 'संबंधी' };
  const SEX = { M: 'पु.', F: 'म.', O: 'अ.' };
  const SHOW = { pending: 'जिनसे नहीं मिले (बाकी)', tried: 'प्रयास हुआ पर नहीं मिले', met: 'मिल चुके', all: 'सभी' };

  window.meetReportPanel = () => {
    const api = window.meetApi;
    const box = h('div', 'rep-box-wrap');
    const open = h('button', 'edit-btn', '📄 PDF सूची बनाएँ (volunteer को देने के लिए)');
    open.type = 'button';
    const panel = h('div', 'rep-panel');
    panel.hidden = true;

    const field = (label, el) => { const w = h('label', 'edit-field', label); w.append(el); return w; };
    const sel = (opts) => { const s = h('select'); opts.forEach(([k, t]) => s.append(new Option(t, k))); return s; };
    const check = (text, on) => {
      const l = h('label', 'rep-check');
      const c = h('input');
      c.type = 'checkbox';
      c.checked = on;
      l.append(c, document.createTextNode(` ${text}`));
      return [l, c];
    };

    const active = () => allVoters.filter((v) => v.is_active);
    const wardIds = [...new Set(active().map((v) => v.ward_id))].sort((a, b) => wardNumbers[a] - wardNumbers[b]);
    const chips = h('div', 'rep-chips');
    wardIds.forEach((id) => {
      const l = h('label', 'rep-chip');
      const c = h('input');
      c.type = 'checkbox';
      c.value = String(id);
      c.addEventListener('change', () => { fillLoc(); update(); });
      l.append(c, document.createTextNode(` Ward ${wardNumbers[id]}`));
      chips.append(l);
    });
    const locSel = sel([['', 'All localities']]);
    const stSel = sel(Object.entries(SHOW));
    const grpSel = sel([['', 'सभी']]);
    const supSel = sel([['', 'सभी'], ['swing', 'Undecided + Leaning (समझाने वाले)'], ['strong_support', 'Strong support'],
      ['leaning', 'Leaning'], ['undecided', 'Undecided'], ['opposition', 'Opposition'], ['unknown', 'अभी आँका नहीं']]);
    const phSel = sel([['', 'सभी'], ['with', 'सिर्फ़ नंबर वाले'], ['without', 'बिना नंबर वाले']]);
    const ageSel = sel([['', 'सभी'], ['60', '60 साल या ज़्यादा (बुज़ुर्ग)'], ['F', 'सिर्फ़ महिलाएँ']]);
    const [houseL, houseC] = check('🏠 घर-वार समूह (एक घर के नाम साथ-साथ)', true);
    const [phoneL, phoneC] = check('मोबाइल नंबर दिखाएँ', true);
    const [photoL, photoC] = check('फ़ोटो दिखाएँ (ज़्यादा नाम हों तो धीमा)', false);
    const volIn = h('input');
    volIn.type = 'text';
    volIn.placeholder = 'Volunteer का नाम (खाली छोड़ें तो लिखने की जगह छपेगी)';
    const info = h('div', 'meet-sub');
    const msg = h('p', 'action-msg');
    const go = h('button', 'visit-btn', '📄 PDF बनाएँ');
    go.type = 'button';

    function fillLoc() {
      const ws = [...chips.querySelectorAll('input:checked')].map((c) => c.value);
      const keep = locSel.value;
      const locs = [...new Set(active().filter((v) => !ws.length || ws.includes(String(v.ward_id))).map((v) => v.locality).filter(Boolean))].sort();
      locSel.replaceChildren(new Option('All localities', ''), ...locs.map((x) => new Option(x, x)));
      if (locs.includes(keep)) locSel.value = keep;
    }
    function fillGroups() {
      const keep = grpSel.value;
      grpSel.replaceChildren(new Option('सभी', ''), ...groups.map((g) => new Option(g.name, String(g.group_id))));
      grpSel.value = keep;
    }

    function pick() {
      const ws = [...chips.querySelectorAll('input:checked')].map((c) => c.value);
      const gset = grpSel.value ? new Set(memberships.filter((m) => String(m.group_id) === grpSel.value).map((m) => m.voter_id)) : null;
      return active().filter((v) => {
        if (ws.length && !ws.includes(String(v.ward_id))) return false;
        if (locSel.value && v.locality !== locSel.value) return false;
        if (gset && !gset.has(v.voter_id)) return false;
        const s = api.stateOf(v);
        if ((stSel.value === 'pending' && s === 'met') || (stSel.value === 'tried' && s !== 'tried') || (stSel.value === 'met' && s !== 'met')) return false;
        const sup = v.support_level || 'unknown';
        if (supSel.value === 'swing' ? !(sup === 'undecided' || sup === 'leaning') : (supSel.value && sup !== supSel.value)) return false;
        const num = !!normPhone(v.phone);
        if ((phSel.value === 'with' && !num) || (phSel.value === 'without' && num)) return false;
        if (ageSel.value === '60' && !(Number(v.age) >= 60)) return false;
        if (ageSel.value === 'F' && v.gender !== 'F') return false;
        return true;
      }).sort(api.cmpHouse);
    }

    function update() {
      const list = pick();
      const perWard = new Map();
      list.forEach((v) => perWard.set(v.ward_id, (perWard.get(v.ward_id) || 0) + 1));
      let pages = 0;
      perWard.forEach((n) => { pages += Math.ceil(n / ROWS_PER_PAGE); });
      info.textContent = `${list.length} voters · लगभग ${pages} पन्ने (हर Ward नए पन्ने से शुरू)`;
    }
    [locSel, stSel, grpSel, supSel, phSel, ageSel].forEach((s) => s.addEventListener('change', update));

    function summary() {
      const ws = [...chips.querySelectorAll('input:checked')].map((c) => `Ward ${wardNumbers[c.value]}`);
      const parts = [ws.length ? ws.join(', ') : 'सभी Wards'];
      if (locSel.value) parts.push(locSel.value);
      parts.push(SHOW[stSel.value]);
      if (grpSel.value) parts.push(`Group: ${grpSel.selectedOptions[0].textContent}`);
      if (supSel.value) parts.push(supSel.selectedOptions[0].textContent);
      if (phSel.value) parts.push(phSel.selectedOptions[0].textContent);
      if (ageSel.value) parts.push(ageSel.selectedOptions[0].textContent);
      return parts.join(' · ');
    }

    async function generate() {
      go.disabled = true;
      msg.textContent = 'तैयार हो रही है…';
      try {
        await api.ensureLoaded();
        const list = pick();
        if (!list.length) { msg.textContent = 'इन filters में कोई voter नहीं।'; return; }
        const withPhoto = photoC.checked;
        const withPhone = phoneC.checked;
        const byHouse = houseC.checked;
        if (withPhoto && list.length > 300 &&
          !confirm(`${list.length} voters हैं। फ़ोटो के साथ PDF बनने में बहुत समय और इंटरनेट लगेगा।\n\nOK = फ़ोटो के साथ, Cancel = रुकें`)) { msg.textContent = ''; return; }

        const old = document.getElementById('print-area');
        if (old) old.remove();
        const area = h('div');
        area.id = 'print-area';
        const date = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
        area.append(
          h('h1', null, `मुलाकात सूची — ${list.length} voters`),
          h('p', 'print-note', `${date} · Volunteer: ${volIn.value.trim() || '______________________'}`),
          h('p', 'print-note', `Filter: ${summary()}`),
          h('p', 'print-note', 'जिनसे व्यक्तिगत रूप से मिल लिए, उनके आगे ☐ में ✓ लगाइए। जो घर पर न मिलें, टिप्पणी में लिख दीजिए (घर बंद / बाहर गाँव / बाद में)।'),
          h('p', 'print-note', 'सिर्फ़ चुनाव कार्य हेतु — गोपनीय, आगे साझा न करें'));

        const cols = 3 + (withPhoto ? 1 : 0) + (byHouse ? 0 : 1) + (withPhone ? 1 : 0) + 1; // ☐, Serial, [फ़ोटो], नाम, उम्र, [मकान], [मोबाइल], टिप्पणी
        const heads = ['☐', 'Serial', ...(withPhoto ? ['फ़ोटो'] : []), 'नाम', 'उम्र / लिंग', ...(byHouse ? [] : ['मकान']),
          ...(withPhone ? ['मोबाइल'] : []), 'पिछली स्थिति / टिप्पणी'];
        const imgs = [];
        const houseCount = new Map();
        list.forEach((v) => houseCount.set(api.famKey(v), (houseCount.get(api.famKey(v)) || 0) + 1));

        const byWard = new Map();
        list.forEach((v) => { if (!byWard.has(v.ward_id)) byWard.set(v.ward_id, []); byWard.get(v.ward_id).push(v); });
        [...byWard.entries()].sort((a, b) => wardNumbers[a[0]] - wardNumbers[b[0]]).forEach(([wid, vs]) => {
          const sec = h('div', 'rep-section');
          sec.append(h('h2', 'rep-ward', `Ward ${wardNumbers[wid]} — ${vs.length} voters`));
          const head = h('tr');
          heads.forEach((t) => head.append(h('th', null, t)));
          const thead = h('thead');
          thead.append(head);
          const tbody = h('tbody');
          let lastLoc = null;
          let lastHouse = null;
          vs.forEach((v) => {
            if (v.locality !== lastLoc) {
              lastLoc = v.locality;
              lastHouse = null;
              const tr = h('tr', 'rep-loc');
              const td = h('td', null, `📍 ${v.locality || '(locality खाली)'}`);
              td.colSpan = cols;
              tr.append(td);
              tbody.append(tr);
            }
            if (byHouse && api.famKey(v) !== lastHouse) {
              lastHouse = api.famKey(v);
              const tr = h('tr', 'rep-house');
              const td = h('td', null, `🏠 मकान ${v.house_number || '— (नंबर नहीं)'} · ${houseCount.get(lastHouse)} सदस्य`);
              td.colSpan = cols;
              tr.append(td);
              tbody.append(tr);
            }
            const tr = h('tr');
            const box = h('td', 'rep-box');
            box.append(h('span', 'rep-sq'));
            tr.append(box, h('td', null, v.serial_number ?? ''));
            if (withPhoto) {
              const td = h('td', 'print-photo-cell');
              if (v.photo_url) {
                const im = h('img', 'print-photo');
                im.alt = '';
                im.src = photoSrc(v);
                imgs.push(im);
                td.append(im);
              }
              tr.append(td);
            }
            const nameTd = h('td');
            nameTd.append(h('div', 'rep-name', v.name || '(name pending)'));
            if (v.relation_name) nameTd.append(h('div', 'rep-rel', `${REL[v.relation_type] || 'संबंधी'}: ${v.relation_name}`));
            tr.append(nameTd, h('td', null, `${v.age || '?'} / ${SEX[v.gender] || '—'}`));
            if (!byHouse) tr.append(h('td', null, v.house_number || ''));
            if (withPhone) tr.append(h('td', null, normPhone(v.phone) || ''));
            const s = api.stateOf(v);
            const last = api.lastAttempt(v);
            const when = last ? new Date(last.met_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '';
            tr.append(h('td', null, s === 'met' ? `✓ मिले (${when})` : s === 'tried' ? `${api.OUTCOME_SHORT[last.outcome]} (${when})` : ''));
            tbody.append(tr);
          });
          const table = h('table');
          table.append(thead, tbody);
          sec.append(table);
          area.append(sec);
        });
        document.body.append(area);

        // फ़ोटो (अधिकतम 8 सेकंड) ताकि वे सच में PDF में आएँ
        let timer;
        await Promise.race([
          Promise.all(imgs.map((im) => (im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; })))),
          new Promise((r) => { timer = setTimeout(r, 8000); }),
        ]);
        clearTimeout(timer);
        msg.textContent = 'Print window में "Save as PDF" चुनिए।';
        const done = () => { area.remove(); window.removeEventListener('afterprint', done); };
        window.addEventListener('afterprint', done);
        window.print();
      } catch (e) {
        msg.textContent = `PDF नहीं बन सकी: ${e.message || e}`;
      } finally {
        go.disabled = false;
      }
    }
    go.addEventListener('click', generate);

    open.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      if (panel.hidden) return;
      // मौजूदा list वाले filters से शुरुआत
      const cur = api.filters();
      chips.querySelectorAll('input').forEach((c) => { c.checked = c.value === cur.ward; });
      fillLoc();
      locSel.value = cur.loc || '';
      stSel.value = cur.show;
      fillGroups();
      update();
    });

    panel.append(
      field('Ward (कई चुन सकते हैं; कुछ न चुनें तो सभी)', chips), field('Locality', locSel), field('स्थिति', stSel),
      field('Group', grpSel), field('Support level', supSel), field('मोबाइल नंबर', phSel), field('उम्र / लिंग', ageSel),
      houseL, phoneL, photoL, field('Volunteer', volIn), info, go, msg);
    box.append(open, panel);
    return box;
  };
})();
