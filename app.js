// ====== CONFIGURE THIS BEFORE DEPLOYING ======
const SUPABASE_URL = 'https://vgtkzghgkxfgqfdkcgid.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_POoKwht72UIlidvQlnWSEg_DUq2XkDr';
// The anon/public key is meant to be visible here — security lives in the
// database's Row Level Security rules. Never put the service_role key here.
// ==============================================

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const loginView = document.getElementById('login-view');
const appView = document.getElementById('app-view');
const detailViewEl = document.getElementById('detail-view');
const loginForm = document.getElementById('login-form');
const loginStatus = document.getElementById('login-status');
const userNameEl = document.getElementById('user-name');
const signoutBtn = document.getElementById('signout-btn');
const importTabBtn = document.getElementById('import-tab-btn');

window.appUser = null;
let currentUserId = null;

function showApp() {
  loginView.hidden = true;
  appView.hidden = false;
  userNameEl.textContent = window.appUser.name;
  importTabBtn.hidden = !window.appUser.isAdmin; // Import tab: admin only
  window.scrollTo(0, 0);
}

function showLogin() {
  appView.hidden = true;
  detailViewEl.hidden = true;
  loginView.hidden = false;
}

// Runs for the first session and real sign-ins/outs only. Token refreshes
// (same user) are ignored, so nobody gets bounced out of a voter page
// mid-edit.
async function handleSession(session) {
  if (!session) {
    currentUserId = null;
    window.appUser = null;
    showLogin();
    document.dispatchEvent(new Event('user-gone'));
    return;
  }
  if (session.user.id === currentUserId) return;
  currentUserId = session.user.id;

  const { data: profile } = await sb
    .from('profiles')
    .select('is_admin, display_name')
    .eq('user_id', session.user.id)
    .maybeSingle();

  window.appUser = {
    id: session.user.id,
    email: session.user.email,
    isAdmin: !!(profile && profile.is_admin),
    name: (profile && profile.display_name) || session.user.email,
  };
  showApp();
  document.dispatchEvent(new Event('user-ready'));
}

sb.auth.getSession().then(({ data: { session } }) => handleSession(session));

// setTimeout avoids a known supabase-js lock-up when calling the database
// directly inside this callback.
sb.auth.onAuthStateChange((_event, session) => {
  setTimeout(() => handleSession(session), 0);
});

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginStatus.textContent = 'Signing in…';

  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  const { error } = await sb.auth.signInWithPassword({ email, password });
  loginStatus.textContent = error ? error.message : '';
});

signoutBtn.addEventListener('click', () => sb.auth.signOut());
