// 💬 फ़ोरम — सभी volunteers की आपसी बातचीत (Performers tab की जगह).
// सिर्फ़ नई टेबल `forum_posts` इस्तेमाल होती है; voters/visits आदि की कोई मौजूदा टेबल नहीं छुई जाती.
// सारा text textContent से डाला जाता है, इसलिए किसी के लिखे अजीब अक्षर page नहीं बिगाड़ सकते.
(() => {
  const root = document.getElementById('forum-root');
  const tabBtn = document.getElementById('forum-tab-btn');
  const TAB_LABEL = '💬 फ़ोरम';
  const MAX_LEN = 1500;
  const SEEN_KEY = 'lordiya_forum_seen';

  let built = false;
  let listEl, moreBtn, stampEl, composerMsg;
  let postLimit = 30;
  let posts = [];            // मुख्य संदेश, नया ऊपर
  let replies = new Map();   // post_id -> [जवाब, पुराना पहले]
  let hasMore = false;
  let loading = false;
  let openReply = null;      // जिस post पर जवाब का box खुला है
  const replyDrafts = new Map();
  let tick = 0;

  const forumVisible = () =>
    !document.hidden && !document.getElementById('app-view').hidden && !document.getElementById('forum-tab').hidden;
  const whenText = (t) => new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const canDelete = (p) => !!window.appUser && (p.user_id === window.appUser.id || window.appUser.isAdmin);

  function linkBtn(text, onClick) {
    const b = h('button', 'dash-link', text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  // ---------- "नया संदेश" का निशान (●) ----------
  const getSeen = () => { try { return localStorage.getItem(SEEN_KEY) || ''; } catch (e) { return ''; } };
  async function newestRow() {
    const { data } = await sb.from('forum_posts').select('created_at, user_id').order('created_at', { ascending: false }).limit(1);
    return data && data[0];
  }
  async function markSeen() {
    tabBtn.textContent = TAB_LABEL;
    const last = await newestRow();
    if (last) { try { localStorage.setItem(SEEN_KEY, last.created_at); } catch (e) { /* private mode */ } }
  }
  async function checkUnread() {
    if (!window.appUser || forumVisible()) return;
    const last = await newestRow();
    if (last && last.user_id !== window.appUser.id && last.created_at > getSeen()) tabBtn.textContent = `${TAB_LABEL} ●`;
  }

  // ---------- Data ----------
  async function fetchAll() {
    const { data: top, error } = await sb.from('forum_posts').select('post_id, user_id, body, created_at')
      .is('parent_id', null).order('created_at', { ascending: false }).limit(postLimit + 1);
    if (error) throw error;
    const shown = top.slice(0, postLimit);
    let reps = [];
    if (shown.length) {
      const { data, error: e2 } = await sb.from('forum_posts').select('post_id, parent_id, user_id, body, created_at')
        .in('parent_id', shown.map((p) => p.post_id)).order('created_at');
      if (e2) throw e2;
      reps = data;
    }
    return { shown, more: top.length > postLimit, reps };
  }

  async function load(force) {
    if (loading) return;
    // कोई लिख रहा हो तो अपने-आप होने वाले refresh से उसका लिखा text न बिगड़े
    const a = document.activeElement;
    if (!force && a && a.tagName === 'TEXTAREA' && root.contains(a) && a.value) return;
    loading = true;
    try {
      const r = await fetchAll();
      posts = r.shown;
      hasMore = r.more;
      replies = new Map();
      r.reps.forEach((x) => { if (!replies.has(x.parent_id)) replies.set(x.parent_id, []); replies.get(x.parent_id).push(x); });
      stampEl.textContent = `अपडेट: ${new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`;
      renderList();
      if (forumVisible()) markSeen();
    } catch (e) {
      listEl.replaceChildren(h('p', 'list-hint', `Couldn't load: ${e.message || e}`));
    }
    loading = false;
  }

  async function sendPost(body, parentId) {
    const row = { body, user_id: window.appUser.id };
    if (parentId) row.parent_id = parentId;
    const { error } = await sb.from('forum_posts').insert(row);
    return error ? `नहीं भेजा जा सका: ${error.message}` : '';
  }

  async function removePost(p, isReply) {
    if (!confirm(isReply ? 'यह जवाब हटाएँ?' : 'यह संदेश (और उसके सारे जवाब) हटाएँ?')) return;
    const { error } = await sb.from('forum_posts').delete().eq('post_id', p.post_id);
    if (error) { alert(`हटाया नहीं जा सका: ${error.message}`); return; }
    load(true);
  }

  // ---------- UI ----------
  function msgNode(p, isReply) {
    const mine = window.appUser && p.user_id === window.appUser.id;
    const box = h('div', `forum-msg${isReply ? ' reply' : ''}${mine ? ' mine' : ''}`);
    const head = h('div', 'forum-head');
    head.append(h('span', 'forum-name', names[p.user_id] || 'Someone'), h('span', 'forum-when', whenText(p.created_at)));
    box.append(head, h('div', 'forum-body', p.body));
    if (canDelete(p)) {
      const del = h('button', 'forum-del', '🗑 हटाएँ');
      del.type = 'button';
      del.addEventListener('click', () => removePost(p, isReply));
      box.append(del);
    }
    return box;
  }

  function replyBox(p) {
    const wrap = h('div', 'forum-reply-box');
    const ta = h('textarea');
    ta.rows = 2;
    ta.maxLength = MAX_LEN;
    ta.placeholder = 'जवाब लिखिए…';
    ta.value = replyDrafts.get(p.post_id) || '';
    ta.addEventListener('input', () => replyDrafts.set(p.post_id, ta.value));
    const send = h('button', 'visit-btn', 'जवाब भेजें');
    send.type = 'button';
    const msg = h('p', 'action-msg');
    send.addEventListener('click', async () => {
      const body = ta.value.trim();
      if (!body) return;
      send.disabled = true;
      msg.textContent = 'भेज रहे हैं…';
      const err = await sendPost(body, p.post_id);
      send.disabled = false;
      if (err) { msg.textContent = err; return; }
      replyDrafts.delete(p.post_id);
      openReply = null;
      load(true);
    });
    wrap.append(ta, send, msg);
    return wrap;
  }

  function postNode(p) {
    const box = h('div', 'forum-post');
    box.append(msgNode(p, false));
    const rs = replies.get(p.post_id) || [];
    if (rs.length) {
      const rb = h('div', 'forum-replies');
      rs.forEach((r) => rb.append(msgNode(r, true)));
      box.append(rb);
    }
    if (openReply === p.post_id) {
      box.append(replyBox(p));
    } else {
      box.append(linkBtn(`↩ जवाब दीजिए${rs.length ? ` (${rs.length})` : ''}`, () => {
        openReply = p.post_id;
        renderList();
        const ta = listEl.querySelector('.forum-reply-box textarea');
        if (ta) ta.focus();
      }));
    }
    return box;
  }

  function renderList() {
    if (!posts.length) {
      listEl.replaceChildren(h('p', 'list-hint', 'अभी कोई संदेश नहीं — ऊपर से पहली बात आप रखिए।'));
    } else {
      listEl.replaceChildren(...posts.map(postNode));
    }
    moreBtn.hidden = !hasMore;
  }

  function build() {
    const ta = h('textarea');
    ta.rows = 3;
    ta.maxLength = MAX_LEN;
    ta.placeholder = 'अपनी बात लिखिए — सुझाव, जानकारी, सवाल…';
    const send = h('button', 'visit-btn', 'भेजें');
    send.type = 'button';
    composerMsg = h('p', 'action-msg');
    send.addEventListener('click', async () => {
      const body = ta.value.trim();
      if (!body) return;
      send.disabled = true;
      composerMsg.textContent = 'भेज रहे हैं…';
      const err = await sendPost(body, null);
      send.disabled = false;
      if (err) { composerMsg.textContent = err; return; }
      ta.value = '';
      composerMsg.textContent = '';
      load(true);
    });

    listEl = h('div', 'forum-list');
    moreBtn = linkBtn('और पुराने संदेश ↓', () => { postLimit += 30; load(true); });
    moreBtn.hidden = true;
    stampEl = h('span', 'muted', '');
    const rf = h('div', 'dash-refresh');
    rf.append(linkBtn('↻ Refresh', () => load(true)), stampEl);

    root.replaceChildren(
      h('h2', 'panel-title', '💬 फ़ोरम'),
      h('p', 'muted', 'सभी volunteers की आपसी बातचीत — सुझाव, जानकारी और सवाल यहीं रखिए।'),
      ta, send, composerMsg, h('div', 'dash-gap'), listEl, moreBtn, rf
    );
    built = true;
  }

  // ---------- Wiring ----------
  tabBtn.addEventListener('click', () => {
    if (!built) build();
    load(true);
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { if (forumVisible()) load(false); else checkUnread(); } });
  setInterval(() => {
    if (!window.appUser || document.hidden) return;
    tick++;
    if (forumVisible()) load(false);
    else if (tick % 3 === 0) checkUnread(); // forum बंद हो तो मिनट में एक बार हल्की जाँच
  }, 20000);
  document.addEventListener('user-ready', () => setTimeout(checkUnread, 3000));
  document.addEventListener('user-gone', () => {
    built = false;
    posts = [];
    replies = new Map();
    openReply = null;
    postLimit = 30;
    replyDrafts.clear();
    tabBtn.textContent = TAB_LABEL;
    root.replaceChildren();
  });
})();
