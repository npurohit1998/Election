// ====== CONFIGURE THIS BEFORE DEPLOYING ======
// Supabase dashboard → your project → Settings → API
const SUPABASE_URL = 'https://vgtkzghgkxfgqfdkcgid.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_POoKwht72UIlidvQlnWSEg_DUq2XkDr';
// The "anon" / "public" key is meant to be visible in client-side code like
// this — Supabase's security lives in Row Level Security policies on the
// database, not in hiding this key. Never put the "service_role" key here.
// ==============================================

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const loginView = document.getElementById('login-view');
const appView = document.getElementById('app-view');
const loginForm = document.getElementById('login-form');
const loginStatus = document.getElementById('login-status');
const userNameEl = document.getElementById('user-name');
const signoutBtn = document.getElementById('signout-btn');

function showApp(user) {
  loginView.hidden = true;
  appView.hidden = false;
  userNameEl.textContent = user.email;
}

function showLogin() {
  appView.hidden = true;
  loginView.hidden = false;
}

// Restore session on page load / PWA relaunch, so people aren't logged out
// every time they reopen the app between doors.
sb.auth.getSession().then(({ data: { session } }) => {
  if (session) showApp(session.user);
});

sb.auth.onAuthStateChange((_event, session) => {
  if (session) showApp(session.user);
  else showLogin();
});

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginStatus.textContent = 'Signing in…';

  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  const { data, error } = await sb.auth.signInWithPassword({ email, password });

  if (error) {
    loginStatus.textContent = error.message;
  } else {
    loginStatus.textContent = '';
    showApp(data.user);
  }
});

signoutBtn.addEventListener('click', async () => {
  await sb.auth.signOut();
  showLogin();
});
