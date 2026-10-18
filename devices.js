// 📱 Devices — हर volunteer की id किन-किन devices पर चल रही है.
// हर device पहली बार खुलने पर अपने लिए एक गुप्त पहचान (random) बनाकर फ़ोन में रख लेता है और
// समय-समय पर `touch_device` से अपनी हाज़िरी दर्ज करता है. सिर्फ़ admin को यह tab दिखता है और वही पढ़ सकता है.
// नोट: iPhone पर "Home Screen वाला app" और "Safari tab" अलग device की तरह गिने जा सकते हैं, और
// browser का data साफ़ करने पर वही फ़ोन नया device बन जाता है — label में "App / Browser tab" इसी लिए दिखता है.
(() => {
  const ACTIVE_DAYS = 7;       // इतने दिन में दिखा और sign out नहीं किया = "सक्रिय" device
  const ONLINE_MIN = 10;       // इतने मिनट में दिखा = "अभी online"
  const TOUCH_EVERY_MS = 5 * 60 * 1000;
  const KEY = 'lordiya_device_id';
  const root = document.getElementById('devices-root');
  const tabBtn = document.getElementById('devices-tab-btn');
  let memId = null;
  let lastTouch = 0;
  let loading = false;

  function deviceId() {
    try {
      let id = localStorage.getItem(KEY);
      if (!id) {
        id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `d-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        localStorage.setItem(KEY, id);
      }
      return id;
    } catch (e) {
      if (!memId) memId = `m-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`; // storage बंद हो तो सिर्फ़ इस session के लिए
      return memId;
    }
  }

  function deviceLabel() {
    const ua = navigator.userAgent;
    const os = /Android/.test(ua) ? 'Android' : /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad'
      : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Unknown';
    const model = (ua.match(/;\s*([^;)]+?)\s+Build\//) || [])[1];
    const br = /SamsungBrowser/.test(ua) ? 'Samsung Browser' : /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera'
      : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /Chrome|CriOS/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : 'Browser';
    const app = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone ? 'App' : 'Browser tab';
    return [os, model, br, app, `${screen.width}×${screen.height}`].filter(Boolean).join(' · ').slice(0, 120);
  }

  async function touch(force) {
    if (!window.appUser) return;
    if (!force && Date.now() - lastTouch < 2 * 60 * 1000) return;
    lastTouch = Date.now();
    const { error } = await sb.rpc('touch_device', { p_device: deviceId(), p_label: deviceLabel(), p_ua: navigator.userAgent.slice(0, 300) });
    if (error) console.warn('device log failed', error.message);
  }

  // Sign out दबाने पर, session खत्म होने से पहले, इस device को "sign out" चिह्नित करता है (app.js इसे बुलाता है)
  window.onBeforeSignOut = () => Promise.race([
    sb.rpc('device_signed_out', { p_device: deviceId() }),
    new Promise((res) => setTimeout(res, 2000)),
  ]);

  // ---------- Admin view ----------
  const ago = (iso) => {
    const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
    if (m < 1) return 'अभी';
    if (m < 60) return `${m} मिनट पहले`;
    const hr = Math.round(m / 60);
    return hr < 24 ? `${hr} घंटे पहले` : `${Math.round(hr / 24)} दिन पहले`;
  };
  const dateText = (iso) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const isActive = (d) => !d.signed_out_at && Date.now() - Date.parse(d.last_seen) < ACTIVE_DAYS * 86400000;

  function deviceRow(d, me) {
    const mins = (Date.now() - Date.parse(d.last_seen)) / 60000;
    const status = d.signed_out_at ? '⚪ Sign out हो चुका' : mins < ONLINE_MIN ? '🟢 अभी online' : isActive(d) ? '🟡 सक्रिय' : '⚪ काफ़ी समय से नहीं दिखा';
    const row = h('div', `dev-row${isActive(d) ? '' : ' off'}`);
    row.append(h('div', 'dev-label', `${d.label || 'Unknown device'}${me && d.device_id === deviceId() ? ' (यह फ़ोन)' : ''}`),
      h('div', 'dev-meta', `${status} · आख़िरी बार ${ago(d.last_seen)}`),
      h('div', 'dev-meta', `पहली बार: ${dateText(d.first_seen)}`));
    return row;
  }

  async function load() {
    if (loading || !window.appUser || !window.appUser.isAdmin) return;
    loading = true;
    if (!root.children.length) root.replaceChildren(h('p', 'list-hint', 'Loading…'));
    try {
      const { data, error } = await sb.from('user_devices').select('*').order('last_seen', { ascending: false });
      if (error) throw error;
      const byUser = new Map();
      data.forEach((d) => { if (!byUser.has(d.user_id)) byUser.set(d.user_id, []); byUser.get(d.user_id).push(d); });
      const ids = [...new Set([...Object.keys(names), ...byUser.keys()])];
      const people = ids.map((id) => {
        const devs = byUser.get(id) || [];
        return { id, devs, active: devs.filter(isActive).length, name: names[id] || 'Someone' };
      }).sort((a, b) => b.active - a.active || a.name.localeCompare(b.name));

      const totalDev = people.reduce((s, p) => s + p.active, 0);
      const multi = people.filter((p) => p.active > 1).length;
      const wrap = h('div');
      wrap.append(h('h2', 'panel-title', '📱 Devices'),
        h('p', 'muted', `सक्रिय = पिछले ${ACTIVE_DAYS} दिनों में खुला और sign out नहीं किया। जिस volunteer की id एक से ज़्यादा device पर हो, वह ⚠ से चिह्नित है।`),
        h('div', 'dev-summary', `${people.filter((p) => p.active).length} volunteers · ${totalDev} सक्रिय devices · ${multi} की id एक से ज़्यादा device पर`));

      people.forEach((p) => {
        const card = h('div', `dev-card${p.active > 1 ? ' multi' : ''}`);
        const head = h('div', 'dev-head');
        head.append(h('span', 'dev-name', p.name),
          h('span', `dev-count${p.active > 1 ? ' warn' : ''}`, p.active > 1 ? `⚠ ${p.active} devices` : `${p.active} device`));
        card.append(head);
        if (!p.devs.length) card.append(h('div', 'dev-meta', 'अभी तक दर्ज नहीं — नया version खुलने पर दिखेगा।'));
        p.devs.forEach((d) => card.append(deviceRow(d, p.id === window.appUser.id)));
        wrap.append(card);
      });

      const rb = h('button', 'dash-link', '↻ Refresh');
      rb.type = 'button';
      rb.addEventListener('click', load);
      wrap.append(rb);
      root.replaceChildren(wrap);
    } catch (e) {
      root.replaceChildren(h('p', 'list-hint', `Couldn't load: ${e.message || e}`));
    }
    loading = false;
  }

  // ---------- Wiring ----------
  document.addEventListener('user-ready', () => {
    tabBtn.hidden = !window.appUser.isAdmin;
    touch(true);
  });
  document.addEventListener('user-gone', () => {
    tabBtn.hidden = true;
    lastTouch = 0;
    root.replaceChildren();
  });
  tabBtn.addEventListener('click', load);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) touch(false); });
  setInterval(() => { if (!document.hidden) touch(false); }, TOUCH_EVERY_MS);
})();
