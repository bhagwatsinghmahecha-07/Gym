// Gym Manager - main app (vanilla JS + Firebase Auth + Firestore). No build step needed.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail,
  sendEmailVerification, sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink, signOut, setPersistence,
  browserLocalPersistence, browserSessionPersistence, updatePassword, reauthenticateWithCredential, EmailAuthProvider,
  verifyBeforeUpdateEmail,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, setDoc, getDoc, deleteDoc, collection,
  onSnapshot, getDocs, writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { firebaseConfig } from '../firebase-config.js';
import {
  $, $$, esc, money, uid, todayStr, addDays, diffDays, fmtDate, calcPeriod, curRenewal, memberInfo, daysBadge, daysText,
  statusBadge, normPhone, validPhone, waLink, fmtMsg, csv, download, compressImage,
} from './util.js';
import { invoiceData, printInvoice, invoiceBlob, shareInvoiceWhatsApp } from './invoice.js';

const root = $('#root');
const configured = firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith('PASTE');
if (!configured) {
  root.innerHTML = `<div class="auth"><div class="auth-card"><div class="brand">🏋️ Almost there</div>
  <p>Open <b>firebase-config.js</b> and paste your Firebase web-app settings, then reload. See README.md step 2.</p></div></div>`;
  throw new Error('Firebase config missing');
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });

if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));

// ------------------------------------------------------------------ state
const DEFAULT_PLANS = [
  { id: 'p1', name: '1 Month', days: 30, price: 1000 },
  { id: 'p3', name: '3 Month', days: 90, price: 2700 },
  { id: 'p6', name: '6 Month', days: 180, price: 5000 },
  { id: 'p12', name: '1 Year', days: 365, price: 9000 },
];
const DEFAULT_TEMPLATE =
  'Hello {name}, your {plan} gym membership expires on {date}. Please renew your subscription to continue your workouts. Thank you! - {gym}';
const DEF_SETTINGS = { gymName: 'My Gym', ownerName: '', phone: '', email: '', plans: DEFAULT_PLANS, template: DEFAULT_TEMPLATE, logo: '', invSeq: 0 };

const S = {
  user: null, settings: { ...DEF_SETTINGS }, members: [], ready: { s: false, m: false }, shell: false,
  route: '', arg: '', sort: { k: 'due', d: 1 }, q: '', fPlan: '', fBatch: '', fStatus: '', batchTab: 'Morning',
  rmonth: todayStr().slice(0, 7), photo: '',
};
let unsubs = [];
const isTouch = matchMedia('(pointer:coarse)').matches;
const uidOf = () => S.user.uid;
const mref = (id) => doc(db, 'gyms', uidOf(), 'members', id);
const sref = () => doc(db, 'gyms', uidOf(), 'settings', 'main');
const saveSettings = (patch) => setDoc(sref(), patch, { merge: true });
const saveMember = (m) => setDoc(mref(m.id), JSON.parse(JSON.stringify(m)));
const getMember = (id) => S.members.find((m) => m.id === id);
const planOf = (id) => S.settings.plans.find((p) => p.id === id);

function toast(msg, type = '') {
  const t = document.createElement('div');
  t.className = 't ' + type;
  t.textContent = msg;
  $('#toast').appendChild(t);
  setTimeout(() => t.remove(), 3800);
}

// ------------------------------------------------------------------ auth screens
const pwField = (name, label, ac = 'current-password') =>
  `<label>${label}<div class="pw"><input type="password" name="${name}" autocomplete="${ac}" required><button type="button" class="eye" data-act="eye" aria-label="Show or hide password">👁</button></div></label>`;

function authScreen(mode = 'login', msg = '') {
  const forms = {
    login: `<p>Sign in to manage your gym</p>${msg}
      <form data-form="login">
        <label>Email or mobile number<input name="id" autocomplete="username" required placeholder="you@email.com or 9876543210"></label>
        ${pwField('pw', 'Password')}
        <label class="chk"><input type="checkbox" name="remember" checked> Remember me</label>
        <div class="err hide" data-err></div>
        <button class="btn primary block" type="submit">Login</button>
      </form>
      <div class="links"><button class="linkbtn" data-act="auth" data-to="forgot">Forgot Password?</button><button class="linkbtn" data-act="auth" data-to="link">Login with OTP link</button></div>
      <div class="links"><span class="mut">New gym?</span><button class="linkbtn" data-act="auth" data-to="signup">Create account</button></div>`,
    signup: `<p>Create your owner account</p>
      <form data-form="signup">
        <div class="grid2"><label>Your name<input name="oname" required autocomplete="name"></label><label>Gym name<input name="gym" required></label></div>
        <div class="grid2"><label>Mobile number<input name="phone" inputmode="numeric" required placeholder="10 digit number" autocomplete="tel"></label><label>Email<input name="email" type="email" required autocomplete="email"></label></div>
        <div class="grid2">${pwField('pw', 'Password (min 8)', 'new-password')}${pwField('pw2', 'Confirm password', 'new-password')}</div>
        <div class="err hide" data-err></div>
        <button class="btn primary block" type="submit">Create account</button>
      </form>
      <div class="links"><button class="linkbtn" data-act="auth" data-to="login">← Back to login</button></div>`,
    forgot: `<p>Enter your registered email or mobile number. We'll email you a secure link to set a new password.</p>
      <form data-form="forgot"><label>Email or mobile number<input name="id" required></label>
        <div class="err hide" data-err></div><div class="ok hide" data-ok></div>
        <button class="btn primary block" type="submit">Send reset link</button></form>
      <div class="links"><button class="linkbtn" data-act="auth" data-to="login">← Back to login</button></div>`,
    link: `<p>Enter your registered email. We'll email you a one-tap sign-in link (no password needed).</p>
      <form data-form="link"><label>Email<input name="email" type="email" required></label>
        <div class="err hide" data-err></div><div class="ok hide" data-ok></div>
        <button class="btn primary block" type="submit">Email me a login link</button></form>
      <div class="links"><button class="linkbtn" data-act="auth" data-to="login">← Back to login</button></div>`,
  };
  S.shell = false;
  root.innerHTML = `<div class="auth"><div class="auth-card"><div class="auth-logo">${ic('dumbbell')}</div><div class="brand">Gym Manager</div>${forms[mode]}</div></div>`;
}

const errMsg = (e) =>
  ({
    'auth/invalid-credential': 'Wrong email/mobile or password.', 'auth/wrong-password': 'Wrong email/mobile or password.',
    'auth/user-not-found': 'No account found with these details.', 'auth/email-already-in-use': 'This email is already registered. Try logging in.',
    'auth/weak-password': 'Password must be at least 8 characters.', 'auth/too-many-requests': 'Too many attempts. Please wait a few minutes and try again.',
    'auth/network-request-failed': 'No internet connection.', 'auth/invalid-email': 'Please enter a valid email.',
    'auth/requires-recent-login': 'Please log in again and retry.', 'permission-denied': 'Database permission denied. Publish firestore.rules (README step 4).',
    'bad-phone': 'Enter a valid 10-digit mobile number.',
  }[e.code] || e.message || 'Something went wrong.');
const showErr = (f, msg) => { const el = $('[data-err]', f); if (el) { el.textContent = msg; el.classList.toggle('hide', !msg); } const ok = $('[data-ok]', f); if (ok) ok.classList.add('hide'); };
const showOk = (f, msg) => { const el = $('[data-ok]', f); if (el) { el.textContent = msg; el.classList.remove('hide'); } const er = $('[data-err]', f); if (er) er.classList.add('hide'); };
const busy = (f, on) => $$('button[type=submit]', f).forEach((b) => (b.disabled = on));

// lockout: 5 wrong tries -> locked 15 min (stored on this device; Firebase also rate-limits server-side)
const lk = (k) => JSON.parse(localStorage.getItem('gm_lock_' + k) || '{}');
const lockMins = (k) => { const o = lk(k); return o.until > Date.now() ? Math.ceil((o.until - Date.now()) / 60000) : 0; };
function failTry(k) {
  let o = lk(k);
  if (o.until && o.until <= Date.now()) o = {};
  o.n = (o.n || 0) + 1;
  if (o.n >= 5) o = { n: 0, until: Date.now() + 15 * 60000 };
  localStorage.setItem('gm_lock_' + k, JSON.stringify(o));
}
const clearTries = (k) => localStorage.removeItem('gm_lock_' + k);
// resend limit: max 1 per minute, 5 per hour
function canSend(k) {
  const now = Date.now();
  const arr = JSON.parse(localStorage.getItem('gm_send_' + k) || '[]').filter((t) => now - t < 3600e3);
  if (arr.length && now - arr[arr.length - 1] < 60e3) return 'Please wait a minute before requesting again.';
  if (arr.length >= 5) return 'Too many requests. Try again in an hour.';
  arr.push(now);
  localStorage.setItem('gm_send_' + k, JSON.stringify(arr));
  return '';
}

async function emailFor(id) {
  id = id.trim();
  if (id.includes('@')) return id;
  const p = normPhone(id);
  if (!validPhone(p)) throw { code: 'bad-phone' };
  const s = await getDoc(doc(db, 'phoneIndex', p));
  if (!s.exists()) throw { code: 'auth/user-not-found' };
  return s.data().email;
}

const formHandlers = {
  async login(f) {
    const d = Object.fromEntries(new FormData(f));
    const m = lockMins('login');
    if (m) return showErr(f, `Too many wrong attempts. Try again in ${m} minute${m > 1 ? 's' : ''}.`);
    busy(f, true); showErr(f, '');
    try {
      const email = await emailFor(d.id);
      await setPersistence(auth, d.remember ? browserLocalPersistence : browserSessionPersistence);
      localStorage.setItem('gm_remember', d.remember ? '1' : '0');
      await signInWithEmailAndPassword(auth, email, d.pw);
      clearTries('login');
    } catch (e) {
      if (['auth/invalid-credential', 'auth/wrong-password'].includes(e.code)) failTry('login');
      showErr(f, errMsg(e));
    }
    busy(f, false);
  },
  async signup(f) {
    const d = Object.fromEntries(new FormData(f));
    const phone = normPhone(d.phone);
    if (!validPhone(phone)) return showErr(f, 'Enter a valid 10-digit mobile number.');
    if (d.pw.length < 8) return showErr(f, 'Password must be at least 8 characters.');
    if (d.pw !== d.pw2) return showErr(f, 'Passwords do not match.');
    busy(f, true); showErr(f, '');
    try {
      if ((await getDoc(doc(db, 'phoneIndex', phone))).exists()) throw { message: 'This mobile number is already registered.' };
      const cred = await createUserWithEmailAndPassword(auth, d.email.trim(), d.pw);
      const u = cred.user.uid;
      await setDoc(doc(db, 'gyms', u, 'settings', 'main'), { ...DEF_SETTINGS, ownerName: d.oname.trim(), gymName: d.gym.trim(), phone, email: d.email.trim() });
      await setDoc(doc(db, 'phoneIndex', phone), { uid: u, email: d.email.trim() });
      sendEmailVerification(cred.user).catch(() => {});
      localStorage.setItem('gm_remember', '1');
    } catch (e) { showErr(f, errMsg(e)); }
    busy(f, false);
  },
  async forgot(f) {
    const d = Object.fromEntries(new FormData(f));
    const wait = canSend('reset');
    if (wait) return showErr(f, wait);
    busy(f, true);
    try {
      const email = await emailFor(d.id);
      await sendPasswordResetEmail(auth, email);
    } catch (e) { if (e.code === 'bad-phone' || e.code === 'auth/network-request-failed' || e.code === 'auth/too-many-requests') { busy(f, false); return showErr(f, errMsg(e)); } }
    showOk(f, 'If this account exists, a password reset link has been sent to its registered email. Open it, set a new password (min 8 characters), then log in.');
    busy(f, false);
  },
  async link(f) {
    const d = Object.fromEntries(new FormData(f));
    const wait = canSend('link');
    if (wait) return showErr(f, wait);
    busy(f, true);
    try {
      await sendSignInLinkToEmail(auth, d.email.trim(), { url: location.origin + '/', handleCodeInApp: true });
      localStorage.setItem('gm_link_email', d.email.trim());
      showOk(f, 'Login link sent. Open the email on this device and tap the link.');
    } catch (e) { showErr(f, errMsg(e)); }
    busy(f, false);
  },
};

// ------------------------------------------------------------------ session: inactivity auto-logout + PIN lock
const touchActivity = () => localStorage.setItem('gm_last', String(Date.now()));
['click', 'keydown', 'touchstart'].forEach((ev) => addEventListener(ev, touchActivity, { passive: true }));
function inactiveTooLong() {
  const last = +localStorage.getItem('gm_last') || Date.now();
  const limit = localStorage.getItem('gm_remember') === '1' ? 7 * 864e5 : 30 * 60e3;
  return Date.now() - last > limit;
}
setInterval(() => { if (S.user && inactiveTooLong()) { toast('Logged out due to inactivity'); signOut(auth); } }, 60e3);

const sha = async (t) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('gm|' + t)))].map((b) => b.toString(16).padStart(2, '0')).join('');
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now();
  else {
    if (hiddenAt && Date.now() - hiddenAt > 60e3 && localStorage.getItem('gm_pin') && S.user) { sessionStorage.removeItem('gm_unlocked'); showLock(); }
    if (S.shell) refresh(); // day may have changed
  }
});
function showLock() {
  if (!localStorage.getItem('gm_pin') || sessionStorage.getItem('gm_unlocked') || !S.user) return ($('#lock').innerHTML = '');
  $('#lock').innerHTML = `<div class="lockov"><div class="auth-card"><div class="brand">🔒 Enter PIN</div><p>Enter your 4-digit app PIN</p>
    <form data-form="unlock"><input name="pin" type="password" inputmode="numeric" maxlength="4" pattern="\\d{4}" autocomplete="off" required autofocus>
    <div class="err hide" data-err style="margin-top:12px"></div><button class="btn primary block" style="margin-top:12px">Unlock</button></form>
    <div class="links"><button class="linkbtn" data-act="logout">Log out instead</button></div></div></div>`;
  setTimeout(() => $('#lock input')?.focus(), 50);
}
formHandlers.unlock = async (f) => {
  const pin = new FormData(f).get('pin');
  if (lockMins('pin')) return showErr(f, `Too many wrong tries. Try again in ${lockMins('pin')} min.`);
  if ((await sha(pin)) === localStorage.getItem('gm_pin')) { clearTries('pin'); sessionStorage.setItem('gm_unlocked', '1'); $('#lock').innerHTML = ''; }
  else { failTry('pin'); showErr(f, 'Wrong PIN'); f.reset(); }
};

// ------------------------------------------------------------------ auth state + data listeners
if (isSignInWithEmailLink(auth, location.href)) {
  (async () => {
    let email = localStorage.getItem('gm_link_email') || prompt('Confirm your email to finish login:');
    try { await signInWithEmailLink(auth, email, location.href); localStorage.setItem('gm_remember', '1'); history.replaceState(null, '', '/'); }
    catch (e) { toast(errMsg(e), 'err'); }
  })();
}

onAuthStateChanged(auth, (user) => {
  unsubs.forEach((u) => u()); unsubs = []; bootDone = false;
  S.shell = false; S.members = []; S.ready = { s: false, m: false }; S.settings = { ...DEF_SETTINGS };
  S.user = user;
  if (!user) { $('#lock').innerHTML = ''; return authScreen('login'); }
  if (inactiveTooLong()) { signOut(auth); return; }
  touchActivity();
  root.innerHTML = '<div class="splash">🏋️ Loading your gym…</div>';
  const fail = (e) => toast(errMsg(e), 'err');
  unsubs.push(onSnapshot(sref(), (snap) => { S.settings = { ...DEF_SETTINGS, ...(snap.data() || {}) }; S.ready.s = true; afterData(); }, fail));
  unsubs.push(onSnapshot(collection(db, 'gyms', user.uid, 'members'), (snap) => {
    S.members = snap.docs.map((d) => { const m = { id: d.id, ...d.data() }; m.renewals ||= []; m.payments ||= []; m.logs ||= []; return m; }).filter((m) => m.renewals.length);
    S.ready.m = true; afterData();
  }, fail));
  showLock();
});

let bootDone = false;
function afterData() {
  if (!S.ready.s || !S.ready.m) return;
  if (!bootDone) { bootDone = true; setTimeout(boot, 1500); }
  refresh();
}
async function boot() {
  bootDone = true;
  try {
    // keep phone lookup in sync if the login email was changed
    const e = S.user.email;
    if (e && S.settings.email !== e) {
      await saveSettings({ email: e });
      if (S.settings.phone) await setDoc(doc(db, 'phoneIndex', S.settings.phone), { uid: uidOf(), email: e });
    }
    const last = S.settings.lastBackupAt ? new Date(S.settings.lastBackupAt).getTime() : 0;
    if (Date.now() - last > 24 * 3600e3) await autoBackup();
  } catch (err) { console.warn('boot tasks', err); }
}

// ------------------------------------------------------------------ shell + router
const ICONS = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.6a3.5 3.5 0 010 6.8"/><path d="M18 14.3c2.2.6 3.5 2.4 3.5 5.7"/>',
  bell: '<path d="M6 16V11a6 6 0 1112 0v5l2 2H4z"/><path d="M10 21a2 2 0 004 0"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  wallet: '<path d="M3 7a2 2 0 012-2h13v4"/><path d="M3 7v11a2 2 0 002 2h15V9H5a2 2 0 01-2-2z"/><circle cx="16.5" cy="14.5" r="1.2"/>',
  chart: '<path d="M4 20V4"/><path d="M4 20h16"/><path d="M8 16v-4"/><path d="M12 16V8"/><path d="M16 16v-6"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
  logout: '<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  dumbbell: '<path d="M6.5 6.5v11M17.5 6.5v11M3 9v6M21 9v6M6.5 12h11"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  rupee: '<path d="M6 4h12M6 9h12M9 4c5 0 6 5 0 5l7 11"/>',
  userplus: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M19 8v6M16 11h6"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.1"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>',
  x: '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
};
const ic = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ''}</svg>`;
const NAV = [
  ['dashboard', 'home', 'Dashboard'], ['members', 'users', 'Members'], ['reminders', 'bell', 'Reminders'],
  ['batches', 'clock', 'Batches'], ['dues', 'wallet', 'Payments & Dues'], ['reports', 'chart', 'Reports'], ['settings', 'gear', 'Settings'],
];
function renderShell() {
  const logo = `<span class="logo">${ic('dumbbell')}</span>`;
  root.innerHTML = `<div class="shell">
    <aside class="side"><div class="brand">${logo}<span data-gym></span></div>
      <nav>${NAV.map(([r, i, l]) => `<button class="navbtn ${['dashboard', 'members', 'reminders'].includes(r) ? 'dup' : ''}" data-act="go" data-to="#/${r}" data-r="${r}">${ic(i)}<span>${l}</span><i class="pip hide" data-pip="${r}"></i></button>`).join('')}</nav>
      <button class="navbtn" data-act="logout">${ic('logout')}<span>Logout</span></button></aside>
    <div class="main">
      <header class="topbar"><div class="tb-brand">${logo}<b data-gym></b></div><button class="iconbtn" data-act="logout" aria-label="Logout">${ic('logout')}</button></header>
      <nav class="toptabs" aria-label="Main">
        <button class="ttab" data-act="go" data-to="#/dashboard" data-r="dashboard">${ic('home')}<span>Home</span></button>
        <button class="ttab" data-act="go" data-to="#/members" data-r="members">${ic('users')}<span>Members</span></button>
        <button class="ttab" data-act="go" data-to="#/reminders" data-r="reminders">${ic('bell')}<span>Reminders</span><i class="pip hide" data-pip="reminders"></i></button>
        <button class="ttab more" data-act="more">${ic('menu')}<span>More</span></button></nav>
      <div class="pagehead"><h1 id="title"></h1></div>
      <div id="banner"></div><main id="view"></main></div>
    <button class="fab" data-act="go" data-to="#/add" aria-label="Add member" title="Add member">${ic('plus')}</button></div>`;
  S.shell = true;
}
function updateChrome() {
  $$('[data-gym]').forEach((e) => (e.textContent = S.settings.gymName));
  const soon = S.members.filter((m) => { const l = memberInfo(m).left; return l >= 0 && l <= 7; }).length;
  $$('[data-pip=reminders]').forEach((e) => { e.textContent = soon; e.classList.toggle('hide', !soon); });
  $$('[data-r]').forEach((b) => b.classList.toggle('on', b.dataset.r === S.route || (S.route === 'member' && b.dataset.r === 'members') || (S.route === 'edit' && b.dataset.r === 'members')));
  $('.fab')?.classList.toggle('hide', S.route === 'add' || S.route === 'edit');
  $('#banner').innerHTML = S.user && !S.user.emailVerified ? `<div class="verify">📧 Please verify your email (check your inbox). <button class="linkbtn" data-act="resendverify">Resend email</button></div>` : '';
}
const setTitle = (t) => { $('#title').textContent = t; document.title = t + ' · ' + S.settings.gymName; };
const view = (html) => ($('#view').innerHTML = html);

const routes = { dashboard: vDashboard, members: vMembers, member: vMember, add: vForm, edit: vForm, reminders: vReminders, batches: vBatches, dues: vDues, reports: vReports, settings: vSettings };
const LIVE = ['dashboard', 'reminders', 'batches', 'dues', 'reports', 'member'];
function route(keepScroll) {
  if (!S.user || !S.ready.s || !S.ready.m) return;
  if (!S.shell) renderShell();
  const [name, arg] = (location.hash.slice(2) || 'dashboard').split('/');
  S.route = routes[name] ? name : 'dashboard'; S.arg = arg;
  if (S.route === 'add' || S.route === 'edit') S.photo = S.route === 'edit' ? getMember(arg)?.photo || '' : '';
  routes[S.route](arg);
  updateChrome();
  if (!keepScroll) scrollTo(0, 0);
}
function refresh() {
  if (!S.ready.s || !S.ready.m) return;
  if (!S.shell) return route();
  updateChrome();
  if (LIVE.includes(S.route)) route(true);
  else if (S.route === 'members') drawMembers();
}
addEventListener('hashchange', () => { closeModal(); route(); });

// ------------------------------------------------------------------ modal
function openModal(title, body, wide) {
  $('#modal').innerHTML = `<div class="ov" data-act="ovclick"><div class="sheet ${wide ? 'wide' : ''}" role="dialog"><div class="sh-h"><h3>${title}</h3><button class="x" data-act="closemodal" aria-label="Close">✕</button></div><div>${body}</div></div></div>`;
  document.body.classList.add('noscroll');
  setTimeout(() => $('#modal input:not([type=hidden]),#modal select')?.focus(), 60);
}
function closeModal() { stopCam(); $('#modal').innerHTML = ''; document.body.classList.remove('noscroll'); }
addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#modal .ov')) closeModal(); });

// ------------------------------------------------------------------ small view pieces
const initials = (n) => (n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const avatar = (m, lg) => (m.photo ? `<img class="av ${lg ? 'lg' : ''}" src="${m.photo}" alt="">` : `<div class="av ${lg ? 'lg' : ''}">${esc(initials(m.name))}</div>`);
const L = () => S.members.map((m) => ({ m, i: memberInfo(m) }));
const planOptions = (sel) => S.settings.plans.map((p) => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)} - ${money(p.price)} (${p.days} days)</option>`).join('');
const waFor = (m, i) => waLink(m.phone, fmtMsg(S.settings.template, { name: m.name, plan: i.c.planName, date: fmtDate(i.c.due), gym: S.settings.gymName }));
const empty = (t) => `<div class="card mut" style="text-align:center">${t}</div>`;

// ------------------------------------------------------------------ DASHBOARD
function vDashboard() {
  setTitle('Dashboard');
  const list = L(), month = todayStr().slice(0, 7);
  const active = list.filter((x) => x.i.status !== 'expired');
  const soon = list.filter((x) => x.i.left >= 0 && x.i.left <= 7).length;
  const revenue = S.members.flatMap((m) => m.payments).filter((p) => p.date.startsWith(month)).reduce((a, p) => a + p.amount, 0);
  const joins = S.members.filter((m) => m.joinDate.startsWith(month)).length;
  const dues = list.reduce((a, x) => a + x.i.balance, 0);
  const planNames = [...new Set([...S.settings.plans.map((p) => p.name), ...active.map((x) => x.i.c.planName)])];
  const cnt = (b) => active.filter((x) => x.m.batch === b).length;
  const hr = new Date().getHours(), greet = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
  const stat = (icon, tone, label, val, href) => `<${href ? `a href="${href}"` : 'div'} class="stat ${tone}"><span class="si">${ic(icon)}</span><div><div class="l">${label}</div><b>${val}</b></div></${href ? 'a' : 'div'}>`;
  view(`<section class="hero"><div><div class="hero-sub">${greet}${S.settings.ownerName ? ', ' + esc(S.settings.ownerName.split(' ')[0]) : ''} 👋</div>
      <div class="hero-t">${esc(S.settings.gymName)}</div><div class="hero-d">${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div></div>
      <div class="hero-n"><div class="l">This month's revenue</div><b>${money(revenue)}</b></div></section>
    <div class="quick"><a class="btn" href="#/reminders">${ic('bell')} Reminders</a><a class="btn" href="#/dues">${ic('wallet')} Collect Payment</a></div>
    <div class="stats">
      ${stat('users', 'tone-blue', 'Total members', list.length)}
      ${stat('check', 'tone-green', 'Active', active.length)}
      ${stat('x', 'tone-red', 'Expired', list.length - active.length)}
      ${stat('bell', 'tone-orange', 'Expiring in 7 days', soon, '#/reminders')}
      ${stat('userplus', 'tone-violet', 'New joinings (month)', joins)}
      ${stat('rupee', 'tone-red', 'Pending dues', money(dues), '#/dues')}</div>
    <div class="dash"><div><h2>Active members by plan</h2><div class="card">${planNames.map((n) => `<div class="kv"><span>${esc(n)}</span><b>${active.filter((x) => x.i.c.planName === n).length}</b></div>`).join('') || '<span class="mut">No plans yet</span>'}</div></div>
    <div><h2>Active members by batch</h2><div class="card">
      <a class="kv" href="#/batches" data-act="tabbatch" data-b="Morning"><span>☀️ Morning batch</span><b>${cnt('Morning')}</b></a>
      <a class="kv" href="#/batches" data-act="tabbatch" data-b="Evening"><span>🌙 Evening batch</span><b>${cnt('Evening')}</b></a></div></div></div>`);
}

// ------------------------------------------------------------------ MEMBERS list
function vMembers() {
  setTitle('Members');
  const opt = (arr, v) => arr.map(([val, l]) => `<option value="${val}" ${val === v ? 'selected' : ''}>${l}</option>`).join('');
  view(`<div class="bar"><div class="mut">Search, filter and manage your members</div><button class="btn primary" data-act="go" data-to="#/add">${ic('plus')} Add Member</button></div>
    <div class="toolbar"><input id="q" type="search" placeholder="Search name or phone" value="${esc(S.q)}">
    <select id="fPlan"><option value="">All plans</option>${opt(S.settings.plans.map((p) => [p.name, p.name]), S.fPlan)}</select>
    <select id="fBatch"><option value="">All batches</option>${opt([['Morning', 'Morning'], ['Evening', 'Evening']], S.fBatch)}</select>
    <select id="fStatus"><option value="">All status</option>${opt([['active', 'Active'], ['soon', 'Expiring Soon'], ['expired', 'Expired']], S.fStatus)}</select></div>
    <div id="mlist"></div>`);
  drawMembers();
}
const SORT_KEYS = {
  name: (x) => x.m.name.toLowerCase(), phone: (x) => x.m.phone, plan: (x) => x.i.c.planName, batch: (x) => x.m.batch,
  start: (x) => x.i.c.start, due: (x) => x.i.c.due, left: (x) => x.i.left, status: (x) => x.i.left, dues: (x) => x.i.balance,
};
function drawMembers() {
  const box = $('#mlist'); if (!box) return;
  const q = S.q.trim().toLowerCase();
  let list = L().filter((x) =>
    (!q || x.m.name.toLowerCase().includes(q) || x.m.phone.includes(q.replace(/\D/g, '') || '§')) &&
    (!S.fPlan || x.i.c.planName === S.fPlan) && (!S.fBatch || x.m.batch === S.fBatch) && (!S.fStatus || x.i.status === S.fStatus));
  const f = SORT_KEYS[S.sort.k];
  list.sort((a, b) => (f(a) > f(b) ? 1 : f(a) < f(b) ? -1 : 0) * S.sort.d);
  if (!list.length) return (box.innerHTML = empty(S.members.length ? 'No members match your search/filters.' : 'No members yet. Tap <b>＋ Add Member</b> to add your first one.'));
  const th = (k, l) => `<th data-act="sort" data-k="${k}">${l}${S.sort.k === k ? (S.sort.d > 0 ? ' ▲' : ' ▼') : ''}</th>`;
  box.innerHTML = `<div class="mut sm" style="margin-bottom:8px">${list.length} member${list.length > 1 ? 's' : ''}</div>
  <div class="cards-only">${list.map(({ m, i }) => `<div class="mcard" data-act="open" data-id="${m.id}">${avatar(m)}<div class="info"><div class="nm">${esc(m.name)}</div>
    <div class="sm mut">${esc(m.phone)} · ${esc(i.c.planName)} · ${m.batch}</div><div class="sm mut">Due ${fmtDate(i.c.due)}</div>
    <div class="row2">${daysBadge(i.left)}${i.balance ? `<span class="badge red">Due ${money(i.balance)}</span>` : ''}</div></div></div>`).join('')}</div>
  <div class="table-only tablewrap"><table><thead><tr><th>Photo</th>${th('name', 'Name')}${th('phone', 'Phone')}${th('plan', 'Plan')}${th('batch', 'Batch')}${th('start', 'Start')}${th('due', 'Due date')}${th('left', 'Days left')}${th('status', 'Status')}${th('dues', 'Pending')}</tr></thead>
  <tbody>${list.map(({ m, i }) => `<tr class="clickable" data-act="open" data-id="${m.id}"><td>${avatar(m)}</td><td><b>${esc(m.name)}</b></td><td>${esc(m.phone)}</td><td>${esc(i.c.planName)}</td><td>${m.batch}</td><td>${fmtDate(i.c.start)}</td><td>${fmtDate(i.c.due)}</td><td>${daysBadge(i.left)}</td><td>${statusBadge(i.status)}</td><td>${i.balance ? `<b style="color:var(--red)">${money(i.balance)}</b>` : '-'}</td></tr>`).join('')}</tbody></table></div>`;
}

// ------------------------------------------------------------------ MEMBER profile
function vMember(id) {
  const m = getMember(id);
  if (!m) { location.hash = '#/members'; return; }
  const i = memberInfo(m);
  setTitle(m.name);
  const rens = [...m.renewals].reverse(), pays = [...m.payments].reverse();
  view(`<a href="#/members" class="sm">‹ All members</a>
  <div class="card" style="margin-top:8px"><div class="head">${avatar(m, true)}<div class="grow"><h2 style="margin:0">${esc(m.name)}</h2>
    <div class="mut">📞 ${esc(m.phone)} · ${m.batch} batch</div><div style="margin-top:6px">${statusBadge(i.status)} ${daysBadge(i.left)}</div></div></div>
    <div class="actions"><button class="btn primary" data-act="renew" data-id="${m.id}">🔄 Renew</button>
    <a class="btn green" href="${waFor(m, i)}" target="_blank" rel="noopener">WhatsApp</a><a class="btn" href="tel:${m.phone}">📞 Call</a>
    ${i.balance ? `<button class="btn" data-act="collect" data-id="${m.id}">💰 Collect ${money(i.balance)}</button>` : ''}
    <button class="btn" data-act="go" data-to="#/edit/${m.id}">✏️ Edit</button>
    <button class="btn" data-act="movebatch" data-id="${m.id}">⇄ Move to ${m.batch === 'Morning' ? 'Evening' : 'Morning'}</button>
    <button class="btn danger" data-act="delmember" data-id="${m.id}">🗑 Delete</button></div></div>
  <div class="dash"><div><h2>Subscription</h2><div class="card">
    <div class="kv"><span>Current plan</span><b>${esc(i.c.planName)}</b></div><div class="kv"><span>Start date</span><b>${fmtDate(i.c.start)}</b></div>
    <div class="kv"><span>Due date</span><b>${fmtDate(i.c.due)}</b></div><div class="kv"><span>Days left</span><b>${daysText(i.left)}</b></div>
    <div class="kv"><span>Total billed</span><b>${money(i.net)}</b></div><div class="kv"><span>Total paid</span><b>${money(i.paid)}</b></div>
    <div class="kv"><span>Pending balance</span><b style="color:${i.balance ? 'var(--red)' : 'var(--green)'}">${money(i.balance)}</b></div>
    <button class="btn block" style="margin-top:10px" data-act="editrenew" data-id="${m.id}">✏️ Edit renewal date / plan</button></div></div>
  <div><h2>Details</h2><div class="card">
    ${[['Age', m.age], ['Gender', m.gender], ['Joined', fmtDate(m.joinDate)], ['Emergency contact', m.emergency], ['Address', m.address], ['Notes', m.notes]].map(([k, v]) => `<div class="kv"><span>${k}</span><b style="text-align:right;max-width:60%">${esc(v) || '-'}</b></div>`).join('')}</div></div></div>
  <h2>Renewal history</h2><div class="tablewrap"><table><thead><tr><th>Renewed on</th><th>Plan</th><th>Amount</th><th>Discount</th><th>Start</th><th>Due</th></tr></thead><tbody>
    ${rens.map((r) => `<tr><td>${fmtDate(r.date)}</td><td>${esc(r.planName)}</td><td>${money(r.price)}</td><td>${money(r.discount)}</td><td>${fmtDate(r.start)}</td><td>${fmtDate(r.due)}</td></tr>`).join('')}</tbody></table></div>
  <h2>Payment history & invoices</h2>${pays.length ? `<div class="tablewrap"><table><thead><tr><th>Date</th><th>Amount</th><th>Mode</th><th>Invoice</th><th></th></tr></thead><tbody>
    ${pays.map((p) => `<tr><td>${fmtDate(p.date)}</td><td>${money(p.amount)}</td><td>${p.mode}</td><td>${esc(p.invoiceNo || '-')}</td><td><button class="btn sm" data-act="invoice" data-id="${m.id}" data-p="${p.id}">🧾 Invoice</button></td></tr>`).join('')}</tbody></table></div>` : empty('No payments yet')}
  ${m.logs.length ? `<h2>Edit log</h2><div class="card sm">${[...m.logs].reverse().map((l) => `<div class="kv"><span>${esc(l.text)}</span><span class="mut">${new Date(l.at).toLocaleString('en-IN')}</span></div>`).join('')}</div>` : ''}`);
}

// ------------------------------------------------------------------ ADD / EDIT member form
function vForm(id) {
  const m = S.route === 'edit' ? getMember(id) : null;
  if (S.route === 'edit' && !m) { location.hash = '#/members'; return; }
  setTitle(m ? 'Edit Member' : 'Add Member');
  const v = (k) => esc(m?.[k] ?? '');
  const sel = (k, arr, d) => arr.map((x) => `<option ${(m?.[k] ?? d) === x ? 'selected' : ''}>${x}</option>`).join('');
  const firstPlan = S.settings.plans[0];
  view(`<form data-form="member" id="mform" ${m ? `data-id="${m.id}"` : ''} class="card" autocomplete="off">
    <div class="err hide" data-err></div>
    <div class="photo-box"><div class="pv" id="pv">${S.photo ? `<img src="${S.photo}">` : '📷'}</div>
      <div class="photo-btns"><button type="button" class="btn" data-act="takephoto">📸 Take Photo</button>
      <button type="button" class="btn" data-act="choosephoto">🖼️ ${isTouch ? 'Choose from Gallery' : 'Upload from computer'}</button>
      <button type="button" class="btn sm ${S.photo ? '' : 'hide'}" id="rmph" data-act="rmphoto">Remove</button></div>
      <div class="drop" id="drop">…or drag & drop a photo here</div>
      <input type="file" id="fileIn" accept="image/*" hidden><input type="file" id="camIn" accept="image/*" capture="user" hidden></div>
    <div class="grid2"><label>Full name *<input name="name" required value="${v('name')}"></label>
      <label>Phone / WhatsApp number *<input name="phone" required inputmode="numeric" placeholder="10 digit mobile" value="${v('phone')}"></label></div>
    <div class="grid3"><label>Age<input name="age" type="number" min="5" max="100" value="${v('age')}"></label>
      <label>Gender<select name="gender">${sel('gender', ['Male', 'Female', 'Other'], 'Male')}</select></label>
      <label>Batch<select name="batch">${sel('batch', ['Morning', 'Evening'], 'Morning')}</select></label></div>
    <div class="grid2"><label>Emergency contact<input name="emergency" value="${v('emergency')}" placeholder="Name & number"></label>
      <label>Joining date<input name="joinDate" type="date" required value="${m?.joinDate || todayStr()}"></label></div>
    <label>Address<textarea name="address" style="min-height:64px">${v('address')}</textarea></label>
    ${m ? `<div class="note">Changing the <b>joining date</b> here recalculates the due date automatically (joining date + plan days). To change the plan use <b>Edit renewal date / plan</b> on the profile.</div>` : `
    <h2>Plan & payment</h2>
    <div class="grid2"><label>Plan<select name="plan">${planOptions(firstPlan?.id)}</select></label>
      <label>Discount (₹)<input name="discount" type="number" min="0" step="any" value="0"></label></div>
    <div class="grid2"><label>Amount paid (₹)<input name="paid" type="number" min="0" step="any" value="${firstPlan?.price || 0}"></label>
      <label>Payment mode<select name="mode"><option>Cash</option><option>UPI</option><option>Card</option></select></label></div>
    <div class="preview" id="prev"></div>`}
    <label>Notes<textarea name="notes" style="min-height:64px">${v('notes')}</textarea></label>
    <div class="actions"><button class="btn primary" type="submit">💾 Save member</button><button class="btn" type="button" data-act="go" data-to="${m ? '#/member/' + m.id : '#/members'}">Cancel</button></div></form>`);
  if (!m) updateAddPreview(true);
  bindPhotoDrop();
}
function updateAddPreview(resetPaid) {
  const f = $('#mform'); if (!f || f.dataset.id) return;
  const d = Object.fromEntries(new FormData(f)), p = planOf(d.plan);
  if (!p) return ($('#prev').innerHTML = 'Add a plan in Settings first.');
  const disc = Math.max(0, +d.discount || 0), net = Math.max(0, p.price - disc);
  if (resetPaid) f.paid.value = net;
  const paid = +f.paid.value || 0, per = calcPeriod(null, d.joinDate, p.days);
  $('#prev').innerHTML = `<div class="kv"><span>Start date</span><b>${fmtDate(per.start)}</b></div><div class="kv"><span>Due date (${p.days} days)</span><b>${fmtDate(per.due)}</b></div>
    <div class="kv"><span>Plan price − discount</span><b>${money(net)}</b></div><div class="kv"><span>Balance after payment</span><b>${money(Math.max(0, net - paid))}</b></div>`;
}

// photo handling: phone -> camera/gallery inputs; laptop -> webcam + file/drag-drop
function setPhoto(url) {
  S.photo = url;
  const pv = $('#pv'); if (pv) pv.innerHTML = url ? `<img src="${url}">` : '📷';
  $('#rmph')?.classList.toggle('hide', !url);
}
async function takePhotoFile(file) {
  if (!file) return;
  try { setPhoto(await compressImage(file)); } catch { toast('Could not read that image', 'err'); }
}
function bindPhotoDrop() {
  $('#fileIn')?.addEventListener('change', (e) => takePhotoFile(e.target.files[0]));
  $('#camIn')?.addEventListener('change', (e) => takePhotoFile(e.target.files[0]));
  const box = $('.photo-box'); if (!box) return;
  ['dragenter', 'dragover'].forEach((ev) => box.addEventListener(ev, (e) => { e.preventDefault(); $('#drop')?.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => box.addEventListener(ev, (e) => { e.preventDefault(); $('#drop')?.classList.remove('over'); }));
  box.addEventListener('drop', (e) => takePhotoFile(e.dataTransfer.files[0]));
}
let camStream;
function stopCam() { camStream?.getTracks().forEach((t) => t.stop()); camStream = null; }
async function openWebcam() {
  if (!navigator.mediaDevices?.getUserMedia) return toast('Camera not available here. Use Upload instead.', 'err');
  openModal('Take Photo', `<video id="cam" class="cam" autoplay playsinline muted></video><div class="actions"><button class="btn primary" data-act="snap">📸 Capture</button><button class="btn" data-act="closemodal">Cancel</button></div>`);
  try { camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640 } }); $('#cam').srcObject = camStream; }
  catch { closeModal(); toast('Camera permission denied or no camera found. Use Upload instead.', 'err'); }
}
async function snap() {
  const v = $('#cam'); if (!v?.videoWidth) return;
  const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d').drawImage(v, 0, 0);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
  closeModal(); await takePhotoFile(blob);
}

formHandlers.member = async (f) => {
  const d = Object.fromEntries(new FormData(f)), editId = f.dataset.id;
  const phone = normPhone(d.phone);
  if (!d.name.trim()) return showErr(f, 'Please enter the member name.');
  if (!validPhone(phone)) return showErr(f, 'Enter a valid 10-digit mobile number (starting with 6-9).');
  const dup = S.members.find((m) => m.phone === phone && m.id !== editId);
  if (dup) return showErr(f, `A member with this phone number already exists: ${dup.name}.`);
  busy(f, true);
  try {
    const base = { name: d.name.trim(), phone, age: d.age, gender: d.gender, batch: d.batch, emergency: d.emergency, address: d.address, joinDate: d.joinDate, notes: d.notes, photo: S.photo || '' };
    if (editId) {
      const m = structuredClone(getMember(editId)), oldJoin = m.joinDate;
      Object.assign(m, base);
      if (oldJoin !== m.joinDate) {
        const oldDue = curRenewal(m).due;
        rechain(m);
        m.logs.push({ at: Date.now(), text: `Joining date ${fmtDate(oldJoin)} → ${fmtDate(m.joinDate)}; due date ${fmtDate(oldDue)} → ${fmtDate(curRenewal(m).due)}` });
      }
      await saveMember(m);
      toast(oldJoin !== m.joinDate ? 'Updated. New due date: ' + fmtDate(curRenewal(m).due) : 'Member updated'); location.hash = '#/member/' + editId;
    } else {
      const p = planOf(d.plan);
      if (!p) throw { message: 'Please add a plan in Settings first.' };
      const disc = Math.max(0, +d.discount || 0), paid = Math.max(0, +d.paid || 0), net = Math.max(0, p.price - disc);
      if (paid > net) throw { message: 'Amount paid cannot be more than the plan price after discount.' };
      const per = calcPeriod(null, d.joinDate, p.days);
      const m = { id: uid(), ...base, createdAt: Date.now(), payments: [], logs: [{ at: Date.now(), text: 'Member added' }],
        renewals: [{ id: uid(), date: d.joinDate, planId: p.id, planName: p.name, days: p.days, price: p.price, discount: disc, start: per.start, due: per.due }] };
      if (paid > 0) await addPayment(m, paid, d.mode, d.joinDate, net - paid);
      await saveMember(m);
      toast('Member added'); location.hash = '#/member/' + m.id;
    }
  } catch (e) { showErr(f, errMsg(e)); }
  busy(f, false);
};

// Recalculate every renewal's start/due from the joining date + plan days (first renewal starts on the joining date)
function syncSnaps(m) {
  m.payments.forEach((p) => {
    const r = m.renewals.find((x) => x.id === p.renewalId);
    if (r && p.snap) Object.assign(p.snap, { start: r.start, due: r.due, planName: r.planName, price: r.price });
  });
}
function rechain(m) {
  let prevDue = null;
  m.renewals.forEach((r, k) => {
    if (k === 0) r.date = m.joinDate;
    const per = calcPeriod(prevDue, r.date, r.days);
    r.start = per.start; r.due = per.due; prevDue = r.due;
  });
  syncSnaps(m);
}

// ------------------------------------------------------------------ payments helper
async function nextInvoiceNo() {
  const n = (S.settings.invSeq || 0) + 1;
  S.settings.invSeq = n;
  await saveSettings({ invSeq: n });
  return 'INV-' + String(n).padStart(4, '0');
}
// pushes a payment (with invoice snapshot) onto member m (caller saves the member)
async function addPayment(m, amount, mode, date, balanceAfter, note = '') {
  const c = curRenewal(m);
  m.payments.push({ id: uid(), date, amount, mode, note, invoiceNo: await nextInvoiceNo(), renewalId: c.id,
    snap: { planName: c.planName, start: c.start, due: c.due, price: c.price, discount: c.discount || 0, balance: balanceAfter } });
}

// ------------------------------------------------------------------ RENEW modal
const periodPreview = (prevDue, date, days, price, disc, paid) => {
  if (!date) return '';
  const per = calcPeriod(prevDue, date, days), left = diffDays(per.due, todayStr());
  const bad = per.due < per.start;
  const net = Math.max(0, price - disc);
  return bad ? `<div class="preview bad">⚠️ Due date cannot be earlier than the start date.</div>` : `<div class="preview">
    <div class="kv"><span>${prevDue && prevDue >= date ? 'Old plan still active → new period starts at old due date' : 'New period starts on renewal date'}</span></div>
    <div class="kv"><span>Start date</span><b>${fmtDate(per.start)}</b></div><div class="kv"><span>Due date (${days} days)</span><b>${fmtDate(per.due)}</b></div>
    <div class="kv"><span>Days left after renewal</span><b>${daysText(left)}</b></div>
    <div class="kv"><span>Amount to pay</span><b>${money(net)}</b></div><div class="kv"><span>Balance after this payment</span><b>${money(Math.max(0, net - paid))}</b></div></div>`;
};
function openRenew(id) {
  const m = getMember(id); if (!m) return;
  const prev = curRenewal(m), p0 = planOf(prev.planId) || S.settings.plans[0];
  openModal('Renew · ' + esc(m.name), `<form data-form="renew" data-id="${id}">
    <div class="err hide" data-err></div>
    <label>Plan<select name="plan">${planOptions(p0?.id)}</select></label>
    <div class="grid2"><label>Renewal date<input type="date" name="date" value="${todayStr()}" required></label>
    <label>Discount (₹)<input type="number" name="discount" min="0" step="any" value="0"></label></div>
    <div class="grid2"><label>Amount paid (₹)<input type="number" name="paid" min="0" step="any"></label>
    <label>Payment mode<select name="mode"><option>Cash</option><option>UPI</option><option>Card</option></select></label></div>
    <div id="rprev"></div><button class="btn primary block" type="submit">✅ Confirm & save renewal</button></form>`);
  const f = $('#modal form');
  const upd = (reset) => {
    const d = Object.fromEntries(new FormData(f)), p = planOf(d.plan); if (!p) return;
    const disc = Math.max(0, +d.discount || 0);
    if (reset) f.paid.value = Math.max(0, p.price - disc);
    $('#rprev').innerHTML = periodPreview(prev.due, d.date, p.days, p.price, disc, +f.paid.value || 0);
  };
  f.addEventListener('input', (e) => upd(e.target.name === 'plan' || e.target.name === 'discount'));
  upd(true);
}
formHandlers.renew = async (f) => {
  const d = Object.fromEntries(new FormData(f)), m = structuredClone(getMember(f.dataset.id)), p = planOf(d.plan);
  const prev = curRenewal(m);
  const disc = Math.max(0, +d.discount || 0), paid = Math.max(0, +d.paid || 0), net = Math.max(0, p.price - disc);
  if (paid > net) return showErr(f, 'Amount paid cannot be more than the amount to pay.');
  const per = calcPeriod(prev.due, d.date, p.days);
  if (per.due < per.start) return showErr(f, 'Due date cannot be earlier than the start date.');
  busy(f, true);
  try {
    m.renewals.push({ id: uid(), date: d.date, planId: p.id, planName: p.name, days: p.days, price: p.price, discount: disc, start: per.start, due: per.due });
    m.logs.push({ at: Date.now(), text: `Renewed ${p.name}: ${fmtDate(per.start)} → ${fmtDate(per.due)}` });
    if (paid > 0) await addPayment(m, paid, d.mode, d.date, Math.max(0, memberInfo(m).balance - paid));
    await saveMember(m);
    closeModal(); toast('Renewed until ' + fmtDate(per.due));
  } catch (e) { showErr(f, errMsg(e)); }
  busy(f, false);
};

// EDIT current renewal: change start date and/or plan, due date recalculates
function openEditRenew(id) {
  const m = getMember(id), r = curRenewal(m);
  openModal('Edit renewal · ' + esc(m.name), `<form data-form="editrenew" data-id="${id}">
    <div class="err hide" data-err></div>
    <label>Renewal / start date<input type="date" name="start" value="${r.start}" required></label>
    <label>Plan<select name="plan">${S.settings.plans.map((p) => `<option value="${p.id}" ${p.id === r.planId ? 'selected' : ''}>${esc(p.name)} - ${p.days} days - ${money(p.price)}</option>`).join('')}</select></label>
    <div id="eprev"></div><button class="btn primary block" type="submit">💾 Save changes</button></form>`);
  const f = $('#modal form');
  const days = () => { const p = planOf(f.plan.value); return p && p.id !== r.planId ? p.days : r.days; };
  const upd = () => {
    const per = { start: f.start.value }, d = days();
    if (!per.start) return;
    const due = addDays(per.start, d);
    $('#eprev').innerHTML = `<div class="preview"><div class="kv"><span>New start date</span><b>${fmtDate(per.start)}</b></div><div class="kv"><span>New due date (${d} days)</span><b>${fmtDate(due)}</b></div><div class="kv"><span>Days left</span><b>${daysText(diffDays(due, todayStr()))}</b></div></div>`;
  };
  f.addEventListener('input', upd); upd();
}
formHandlers.editrenew = async (f) => {
  const d = Object.fromEntries(new FormData(f)), m = structuredClone(getMember(f.dataset.id)), r = curRenewal(m), old = { ...r };
  const p = planOf(d.plan), changedPlan = p.id !== r.planId;
  if (!d.start) return showErr(f, 'Please choose a date.');
  const days = changedPlan ? p.days : r.days, due = addDays(d.start, days);
  if (due < d.start || days < 1) return showErr(f, 'Due date cannot be earlier than the start date.');
  if (changedPlan && p.price !== r.price && confirm(`The new plan costs ${money(p.price)} but this renewal was billed ${money(r.price)}.\n\nOK = change the amount to ${money(p.price)} and update the pending balance.\nCancel = keep the old amount.`)) r.price = p.price;
  if (changedPlan) { r.planId = p.id; r.planName = p.name; r.days = p.days; }
  r.start = d.start; r.due = due; r.date = d.start;
  if (m.renewals.length === 1) m.joinDate = d.start;
  const ch = [];
  if (old.start !== r.start) ch.push(`start ${fmtDate(old.start)} → ${fmtDate(r.start)}`);
  if (old.planName !== r.planName) ch.push(`plan ${old.planName} → ${r.planName}`);
  if (old.due !== r.due) ch.push(`due ${fmtDate(old.due)} → ${fmtDate(r.due)}`);
  if (old.price !== r.price) ch.push(`amount ${money(old.price)} → ${money(r.price)}`);
  if (!ch.length) return closeModal();
  m.logs.push({ at: Date.now(), text: 'Renewal edited: ' + ch.join('; ') });
  syncSnaps(m);
  busy(f, true);
  try { await saveMember(m); closeModal(); toast('Renewal updated. Due date: ' + fmtDate(r.due)); } catch (e) { showErr(f, errMsg(e)); }
  busy(f, false);
};

// COLLECT pending balance
function openCollect(id) {
  const m = getMember(id), i = memberInfo(m);
  openModal('Collect payment · ' + esc(m.name), `<form data-form="collect" data-id="${id}"><div class="err hide" data-err></div>
    <div class="preview"><div class="kv"><span>Pending balance</span><b>${money(i.balance)}</b></div></div>
    <div class="grid2"><label>Amount (₹)<input type="number" name="amount" min="1" step="any" max="${i.balance}" value="${i.balance}" required></label>
    <label>Payment mode<select name="mode"><option>Cash</option><option>UPI</option><option>Card</option></select></label></div>
    <label>Date<input type="date" name="date" value="${todayStr()}" required></label>
    <button class="btn primary block" type="submit">Save payment</button></form>`);
}
formHandlers.collect = async (f) => {
  const d = Object.fromEntries(new FormData(f)), m = structuredClone(getMember(f.dataset.id)), amt = +d.amount, bal = memberInfo(m).balance;
  if (!(amt > 0) || amt > bal) return showErr(f, `Enter an amount between 1 and ${money(bal)}.`);
  busy(f, true);
  try { await addPayment(m, amt, d.mode, d.date, bal - amt, 'Dues payment'); await saveMember(m); closeModal(); toast('Payment saved'); } catch (e) { showErr(f, errMsg(e)); }
  busy(f, false);
};

// invoice modal
function openInvoice(mid, pid) {
  const m = getMember(mid), p = m.payments.find((x) => x.id === pid);
  const d = invoiceData(S.settings, m, p);
  openModal('Invoice ' + esc(d.no), `<div class="preview"><div class="kv"><span>${esc(d.name)}</span><b>${money(d.paid)}</b></div><div class="kv"><span>${esc(d.plan)}</span><span>${fmtDate(d.start)} → ${fmtDate(d.due)}</span></div><div class="kv"><span>Balance due</span><b>${money(d.balance)}</b></div></div>
    <div class="actions"><button class="btn primary" data-act="invpdf" data-m="${mid}" data-p="${pid}">⬇️ Download PDF</button>
    <button class="btn" data-act="invprint" data-m="${mid}" data-p="${pid}">🖨 Print</button>
    <button class="btn green" data-act="invwa" data-m="${mid}" data-p="${pid}">Send on WhatsApp</button></div>`);
}
const invFor = (a) => { const m = getMember(a.m), p = m.payments.find((x) => x.id === a.p); return invoiceData(S.settings, m, p); };

// ------------------------------------------------------------------ REMINDERS
function reminderRow(x) {
  const { m, i } = x;
  return `<div class="rrow ${i.left === 1 ? 'tmr' : ''}">${avatar(m)}<div class="info"><div><b>${esc(m.name)}</b> ${i.left === 1 ? '<span class="badge pulse">Send reminder today</span>' : ''}</div>
    <div class="sm mut">${esc(i.c.planName)} · ${m.batch} · due ${fmtDate(i.c.due)}</div><div style="margin-top:4px">${daysBadge(i.left)}${i.balance ? ` <span class="badge red">Due ${money(i.balance)}</span>` : ''}</div></div>
    <div class="acts"><a class="btn green" href="${waFor(m, i)}" target="_blank" rel="noopener">WhatsApp Reminder</a><a class="btn" href="tel:${m.phone}">📞 Call</a>
    <button class="btn primary" data-act="renew" data-id="${m.id}">Renew Now</button></div></div>`;
}
function vReminders() {
  setTitle('Renewal Reminders');
  const list = L(), soon = list.filter((x) => x.i.left >= 0 && x.i.left <= 7).sort((a, b) => a.i.left - b.i.left);
  const exp = list.filter((x) => x.i.left < 0).sort((a, b) => b.i.left - a.i.left);
  const tmr = soon.filter((x) => x.i.left === 1).length;
  view(`${tmr ? `<button class="btn primary block" data-act="walltomorrow" style="margin-bottom:6px">📲 Send to all expiring tomorrow (${tmr})</button>` : ''}
    <h2>Expiring in the next 7 days (${soon.length})</h2>${soon.map(reminderRow).join('') || empty('🎉 Nobody expiring in the next 7 days')}
    <h2>Already expired (${exp.length})</h2>${exp.map(reminderRow).join('') || empty('No expired members')}`);
}
let walList = [], walIdx = 0;
function walStep() {
  const x = walList[walIdx];
  if (!x) { closeModal(); return toast('All reminders done ✅'); }
  openModal(`Reminder ${walIdx + 1} of ${walList.length}`, `<div class="head" style="margin-bottom:12px">${avatar(x.m, true)}<div class="grow"><h3>${esc(x.m.name)}</h3><div class="mut">${esc(x.i.c.planName)} · expires ${fmtDate(x.i.c.due)}</div></div></div>
    <div class="preview">${esc(fmtMsg(S.settings.template, { name: x.m.name, plan: x.i.c.planName, date: fmtDate(x.i.c.due), gym: S.settings.gymName }))}</div>
    <div class="actions"><a class="btn green" href="${waFor(x.m, x.i)}" target="_blank" rel="noopener" data-act="walnext">Open WhatsApp & next ›</a><button class="btn" data-act="walnext">Skip ›</button></div>`);
}

// ------------------------------------------------------------------ BATCHES
function vBatches() {
  setTitle('Batches');
  const list = L(), cnt = (b) => list.filter((x) => x.m.batch === b).length, other = S.batchTab === 'Morning' ? 'Evening' : 'Morning';
  const rows = list.filter((x) => x.m.batch === S.batchTab).sort((a, b) => a.m.name.localeCompare(b.m.name));
  view(`<div class="seg"><button class="${S.batchTab === 'Morning' ? 'on' : ''}" data-act="tabbatch" data-b="Morning">☀️ Morning (${cnt('Morning')})</button><button class="${S.batchTab === 'Evening' ? 'on' : ''}" data-act="tabbatch" data-b="Evening">🌙 Evening (${cnt('Evening')})</button></div>
    ${rows.map(({ m, i }) => `<div class="rrow">${avatar(m)}<div class="info" data-act="open" data-id="${m.id}" style="cursor:pointer"><b>${esc(m.name)}</b><div class="sm mut">${esc(m.phone)} · ${esc(i.c.planName)}</div><div style="margin-top:4px">${daysBadge(i.left)}</div></div>
    <button class="btn sm" data-act="movebatch" data-id="${m.id}">⇄ Move to ${other}</button></div>`).join('') || empty('No members in this batch')}`);
}

// ------------------------------------------------------------------ DUES
function vDues() {
  setTitle('Payments & Dues');
  const rows = L().filter((x) => x.i.balance > 0).sort((a, b) => b.i.balance - a.i.balance), total = rows.reduce((a, x) => a + x.i.balance, 0);
  const recent = S.members.flatMap((m) => m.payments.map((p) => ({ m, p }))).sort((a, b) => (b.p.date + b.p.id).localeCompare(a.p.date + a.p.id)).slice(0, 15);
  view(`<div class="stats" style="margin-bottom:12px"><div class="stat"><div class="l">Total pending dues</div><b style="color:var(--red)">${money(total)}</b></div><div class="stat"><div class="l">Members with dues</div><b>${rows.length}</b></div></div>
    <h2>Pending dues</h2>${rows.map(({ m, i }) => `<div class="rrow">${avatar(m)}<div class="info" data-act="open" data-id="${m.id}" style="cursor:pointer"><b>${esc(m.name)}</b><div class="sm mut">${esc(m.phone)}</div></div><b style="color:var(--red)">${money(i.balance)}</b>
      <button class="btn primary sm" data-act="collect" data-id="${m.id}">Collect</button></div>`).join('') || empty('🎉 No pending dues')}
    <h2>Recent payments</h2>${recent.map(({ m, p }) => `<div class="rrow"><div class="info"><b>${esc(m.name)}</b><div class="sm mut">${fmtDate(p.date)} · ${p.mode} · ${esc(p.invoiceNo || '')}</div></div><b>${money(p.amount)}</b><button class="btn sm" data-act="invoice" data-id="${m.id}" data-p="${p.id}">🧾 Invoice</button></div>`).join('') || empty('No payments yet')}`);
}

// ------------------------------------------------------------------ REPORTS + exports
function vReports() {
  setTitle('Reports');
  const mo = S.rmonth, list = L();
  const pays = S.members.flatMap((m) => m.payments);
  const rev = (ym) => pays.filter((p) => p.date.startsWith(ym)).reduce((a, p) => a + p.amount, 0);
  const joins = S.members.filter((m) => m.joinDate.startsWith(mo)).length;
  const renewals = S.members.reduce((a, m) => a + m.renewals.slice(1).filter((r) => r.date.startsWith(mo)).length, 0);
  const expiredIn = list.filter((x) => x.i.c.due.startsWith(mo) && x.i.left < 0).length;
  const dues = list.reduce((a, x) => a + x.i.balance, 0);
  const months = Array.from({ length: 6 }, (_, k) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 5 + k); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; });
  const vals = months.map(rev), mx = Math.max(...vals, 1);
  view(`<label style="max-width:240px">Month<input type="month" id="rmonth" value="${mo}"></label>
    <div class="stats"><div class="stat"><div class="l">Revenue</div><b>${money(rev(mo))}</b></div><div class="stat"><div class="l">New joinings</div><b>${joins}</b></div><div class="stat"><div class="l">Renewals</div><b>${renewals}</b></div>
    <div class="stat"><div class="l">Expired (due in month)</div><b>${expiredIn}</b></div><div class="stat"><div class="l">Pending dues (now)</div><b style="color:var(--red)">${money(dues)}</b></div></div>
    <h2>Revenue - last 6 months</h2><div class="card"><div class="bars">${months.map((k, n) => `<div class="bar-c"><span>${vals[n] ? money(vals[n]) : ''}</span><i style="height:${Math.round((vals[n] / mx) * 100)}%"></i><span>${k.slice(5)}/${k.slice(2, 4)}</span></div>`).join('')}</div></div>
    <h2>Export (opens in Excel)</h2><div class="actions"><button class="btn" data-act="dlmembers">⬇️ Members CSV</button><button class="btn" data-act="dlpayments">⬇️ Payments CSV</button><button class="btn" data-act="dlrenewals">⬇️ Renewal history CSV</button></div>`);
}
const stamp = () => todayStr();
function exportCSV(kind) {
  if (kind === 'members') download(`members-${stamp()}.csv`, csv([['Name', 'Phone', 'Age', 'Gender', 'Address', 'Emergency', 'Joined', 'Batch', 'Plan', 'Start', 'Due', 'Days left', 'Status', 'Billed', 'Paid', 'Pending', 'Notes'],
    ...L().map(({ m, i }) => [m.name, m.phone, m.age, m.gender, m.address, m.emergency, m.joinDate, m.batch, i.c.planName, i.c.start, i.c.due, i.left, i.status, i.net, i.paid, i.balance, m.notes])]));
  if (kind === 'payments') download(`payments-${stamp()}.csv`, csv([['Date', 'Invoice', 'Member', 'Phone', 'Amount', 'Mode', 'Plan', 'Note'],
    ...S.members.flatMap((m) => m.payments.map((p) => [p.date, p.invoiceNo, m.name, m.phone, p.amount, p.mode, p.snap?.planName, p.note])).sort((a, b) => a[0].localeCompare(b[0]))]));
  if (kind === 'renewals') download(`renewals-${stamp()}.csv`, csv([['Member', 'Phone', 'Renewed on', 'Plan', 'Days', 'Price', 'Discount', 'Start', 'Due'],
    ...S.members.flatMap((m) => m.renewals.map((r) => [m.name, m.phone, r.date, r.planName, r.days, r.price, r.discount, r.start, r.due]))]));
}

// ------------------------------------------------------------------ BACKUP / RESTORE
const makeBackup = () => ({ app: 'gym-manager', version: 1, exportedAt: new Date().toISOString(), settings: S.settings, members: S.members });
async function autoBackup() {
  const data = JSON.stringify(makeBackup()), day = todayStr(), parts = [];
  for (let i = 0; i < data.length; i += 300000) parts.push(data.slice(i, i + 300000));
  const base = doc(db, 'gyms', uidOf(), 'backups', day);
  await setDoc(base, { createdAt: new Date().toISOString(), chunks: parts.length, members: S.members.length });
  for (let i = 0; i < parts.length; i++) await setDoc(doc(db, 'gyms', uidOf(), 'backups', day, 'parts', String(i)), { d: parts[i] });
  await saveSettings({ lastBackupAt: new Date().toISOString() });
  const all = (await getDocs(collection(db, 'gyms', uidOf(), 'backups'))).docs.map((d) => d.id).sort();
  for (const id of all.slice(0, Math.max(0, all.length - 7))) { // keep last 7 daily backups
    for (const p of (await getDocs(collection(db, 'gyms', uidOf(), 'backups', id, 'parts'))).docs) await deleteDoc(p.ref);
    await deleteDoc(doc(db, 'gyms', uidOf(), 'backups', id));
  }
}
async function restoreData(obj) {
  if (obj?.app !== 'gym-manager' || !Array.isArray(obj.members)) throw new Error('This is not a Gym Manager backup file.');
  for (let i = 0; i < obj.members.length; i += 400) {
    const b = writeBatch(db);
    obj.members.slice(i, i + 400).forEach((m) => b.set(mref(m.id), JSON.parse(JSON.stringify(m))));
    await b.commit();
  }
  const s = obj.settings || {};
  await saveSettings({ gymName: s.gymName ?? S.settings.gymName, plans: s.plans ?? S.settings.plans, template: s.template ?? S.settings.template, logo: s.logo ?? '', invSeq: Math.max(s.invSeq || 0, S.settings.invSeq || 0) });
}
async function latestCloudBackup() {
  const ids = (await getDocs(collection(db, 'gyms', uidOf(), 'backups'))).docs.map((d) => d.id).sort();
  if (!ids.length) throw new Error('No cloud backups found yet.');
  const id = ids[ids.length - 1];
  const parts = (await getDocs(collection(db, 'gyms', uidOf(), 'backups', id, 'parts'))).docs.sort((a, b) => +a.id - +b.id).map((d) => d.data().d);
  return { id, obj: JSON.parse(parts.join('')) };
}

// ------------------------------------------------------------------ SETTINGS
const planRow = (p) => `<div class="planrow" data-plan="${p.id}"><input name="pname" value="${esc(p.name)}" placeholder="Plan name" required><input name="pdays" type="number" min="1" step="1" value="${p.days}" title="Days" required><input name="pprice" type="number" min="0" step="any" value="${p.price}" title="Price" required><button type="button" class="btn sm danger" data-act="rmplanrow">Remove</button></div>`;
function vSettings() {
  setTitle('Settings');
  const s = S.settings, last = s.lastBackupAt ? new Date(s.lastBackupAt).toLocaleString('en-IN') : 'Not yet';
  view(`<div class="dash"><div>
    <h2 style="margin-top:0">Gym profile</h2><form class="card" data-form="profile"><div class="err hide" data-err></div>
      <div class="grid2"><label>Gym name<input name="gymName" value="${esc(s.gymName)}" required></label><label>Owner name<input name="ownerName" value="${esc(s.ownerName)}"></label></div>
      <div class="photo-box"><div class="pv" style="width:64px;height:64px">${s.logo ? `<img src="${s.logo}">` : '🏷️'}</div><label style="flex:1;margin:0">Logo (shown on invoices)<input type="file" name="logo" accept="image/*"></label></div>
      <button class="btn primary" type="submit">Save profile</button></form>
    <h2>Plans & pricing</h2><form class="card" data-form="plans"><div class="note">Price/duration changes apply only to new joinings and renewals. Past payments never change.</div><div class="err hide" data-err></div>
      <div id="planrows">${s.plans.map(planRow).join('')}</div>
      <div class="actions"><button type="button" class="btn" data-act="addplanrow">＋ Add plan</button><button class="btn primary" type="submit">Save plans</button></div></form>
    <h2>WhatsApp reminder message</h2><form class="card" data-form="template"><label>Message template<textarea name="template">${esc(s.template)}</textarea></label>
      <div class="sm mut" style="margin-bottom:10px">Use: {name} {plan} {date} {gym}</div><div class="actions"><button class="btn primary" type="submit">Save message</button><button type="button" class="btn" data-act="resettpl">Reset</button></div></form>
  </div><div>
    <h2 style="margin-top:0">Backup & data</h2><div class="card"><div class="kv"><span>Last backup</span><b>${last}</b></div><div class="sm mut" style="margin:8px 0">A backup is saved automatically to the cloud once a day when you open the app (last 7 kept).</div>
      <div class="actions"><button class="btn" data-act="backupnow">☁️ Backup now</button><button class="btn" data-act="dlbackup">⬇️ Download all data</button></div>
      <div class="actions"><button class="btn" data-act="restorefile">⬆️ Restore from file</button><button class="btn" data-act="restorecloud">☁️ Restore latest cloud backup</button></div>
      <input type="file" id="restoreIn" accept=".json,application/json" hidden></div>
    <h2>Security</h2><form class="card" data-form="password"><h3>Change password</h3><div class="err hide" data-err></div>${pwField('cur', 'Current password')}${pwField('n1', 'New password (min 8)', 'new-password')}${pwField('n2', 'Confirm new password', 'new-password')}<button class="btn primary" type="submit">Change password</button></form>
    <form class="card" data-form="email"><h3>Change email</h3><div class="mut sm">Current: ${esc(S.user.email)}. A verification link is sent to the new email.</div><div class="err hide" data-err></div><label style="margin-top:8px">New email<input type="email" name="email" required></label>${pwField('cur', 'Current password')}<button class="btn primary" type="submit">Change email</button></form>
    <form class="card" data-form="mobile"><h3>Change mobile number</h3><div class="mut sm">Current: ${esc(s.phone)}</div><div class="err hide" data-err></div><label style="margin-top:8px">New mobile<input name="phone" inputmode="numeric" required></label>${pwField('cur', 'Current password')}<button class="btn primary" type="submit">Change mobile</button></form>
    <form class="card" data-form="pin"><h3>App PIN lock</h3><div class="mut sm">${localStorage.getItem('gm_pin') ? 'PIN is ON for this device.' : 'Quick unlock with a 4-digit PIN on this device.'}</div><div class="err hide" data-err></div>
      <label style="margin-top:8px">New 4-digit PIN<input name="pin" type="password" inputmode="numeric" maxlength="4" pattern="\\d{4}"></label>
      <div class="actions"><button class="btn primary" type="submit">Set PIN</button>${localStorage.getItem('gm_pin') ? '<button type="button" class="btn" data-act="rmpin">Turn off</button>' : ''}</div></form>
    <button class="btn danger block" data-act="logout">🚪 Logout</button></div></div>`);
  $('#restoreIn')?.addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try { const obj = JSON.parse(await file.text()); if (confirm(`Restore ${obj.members?.length || 0} members from this backup? Existing members with the same ID will be overwritten.`)) { await restoreData(obj); toast('Restore complete ✅'); } }
    catch (err) { toast(err.message || 'Invalid backup file', 'err'); }
    e.target.value = '';
  });
}
async function reauth(f, pw) { await reauthenticateWithCredential(S.user, EmailAuthProvider.credential(S.user.email, pw)); }
Object.assign(formHandlers, {
  async profile(f) {
    busy(f, true);
    try {
      const d = Object.fromEntries(new FormData(f)), patch = { gymName: d.gymName.trim(), ownerName: d.ownerName.trim() };
      if (d.logo && d.logo.size) patch.logo = await compressImage(d.logo, 200, 0.85);
      await saveSettings(patch); toast('Saved'); vSettings();
    } catch (e) { showErr(f, errMsg(e)); }
    busy(f, false);
  },
  async plans(f) {
    const rows = $$('.planrow', f).map((r) => ({ id: r.dataset.plan, name: $('[name=pname]', r).value.trim(), days: Math.floor(+$('[name=pdays]', r).value), price: +$('[name=pprice]', r).value }));
    if (!rows.length) return showErr(f, 'Keep at least one plan.');
    if (rows.some((p) => !p.name || !(p.days >= 1) || !(p.price >= 0))) return showErr(f, 'Each plan needs a name, duration of at least 1 day and a valid price.');
    busy(f, true);
    try { await saveSettings({ plans: rows }); toast('Plans saved'); } catch (e) { showErr(f, errMsg(e)); }
    busy(f, false);
  },
  async template(f) { await saveSettings({ template: new FormData(f).get('template') }); toast('Message saved'); },
  async password(f) {
    const d = Object.fromEntries(new FormData(f));
    if (d.n1.length < 8) return showErr(f, 'New password must be at least 8 characters.');
    if (d.n1 !== d.n2) return showErr(f, 'New passwords do not match.');
    busy(f, true);
    try { await reauth(f, d.cur); await updatePassword(S.user, d.n1); f.reset(); toast('Password changed'); showErr(f, ''); } catch (e) { showErr(f, errMsg(e)); }
    busy(f, false);
  },
  async email(f) {
    const d = Object.fromEntries(new FormData(f)); busy(f, true);
    try { await reauth(f, d.cur); await verifyBeforeUpdateEmail(S.user, d.email.trim()); f.reset(); toast('Verification link sent to the new email. Click it to finish.'); } catch (e) { showErr(f, errMsg(e)); }
    busy(f, false);
  },
  async mobile(f) {
    const d = Object.fromEntries(new FormData(f)), p = normPhone(d.phone);
    if (!validPhone(p)) return showErr(f, 'Enter a valid 10-digit mobile number.');
    busy(f, true);
    try {
      await reauth(f, d.cur);
      if ((await getDoc(doc(db, 'phoneIndex', p))).exists()) throw { message: 'This mobile number is already registered.' };
      const old = S.settings.phone;
      await setDoc(doc(db, 'phoneIndex', p), { uid: uidOf(), email: S.user.email });
      await saveSettings({ phone: p });
      if (old && old !== p) await deleteDoc(doc(db, 'phoneIndex', old)).catch(() => {});
      f.reset(); toast('Mobile number changed');
    } catch (e) { showErr(f, errMsg(e)); }
    busy(f, false);
  },
  async pin(f) {
    const pin = new FormData(f).get('pin');
    if (!/^\d{4}$/.test(pin)) return showErr(f, 'PIN must be exactly 4 digits.');
    localStorage.setItem('gm_pin', await sha(pin)); sessionStorage.setItem('gm_unlocked', '1'); toast('PIN set'); vSettings();
  },
});

// ------------------------------------------------------------------ actions (click delegation)
const actions = {
  go: (a) => (location.hash = a.to),
  auth: (a) => authScreen(a.to),
  eye(a, el) { const i = el.parentElement.querySelector('input'); i.type = i.type === 'password' ? 'text' : 'password'; },
  logout() { sessionStorage.removeItem('gm_unlocked'); signOut(auth); },
  resendverify() { sendEmailVerification(S.user).then(() => toast('Verification email sent')).catch((e) => toast(errMsg(e), 'err')); },
  closemodal: closeModal,
  ovclick(a, el, e) { if (e.target === el) closeModal(); },
  more() { openModal('More', `<div class="actions" style="flex-direction:column">${NAV.filter((n) => ['batches', 'dues', 'reports', 'settings'].includes(n[0])).map(([r, i, l]) => `<button class="btn" data-act="go" data-to="#/${r}">${ic(i)} ${l}</button>`).join('')}<button class="btn danger" data-act="logout">${ic('logout')} Logout</button></div>`); },
  sort(a) { S.sort = { k: a.k, d: S.sort.k === a.k ? -S.sort.d : 1 }; drawMembers(); },
  open: (a) => (location.hash = '#/member/' + a.id),
  renew: (a) => openRenew(a.id),
  editrenew: (a) => openEditRenew(a.id),
  collect: (a) => openCollect(a.id),
  invoice: (a) => openInvoice(a.id, a.p),
  async invpdf(a, el) { el.disabled = true; try { const d = invFor(a); download(`Invoice-${d.no}.pdf`, await invoiceBlob(d)); } catch (e) { toast(e.message, 'err'); } el.disabled = false; },
  invprint: (a) => printInvoice(invFor(a)),
  async invwa(a, el) { el.disabled = true; try { await shareInvoiceWhatsApp(invFor(a), waLink, download); } catch (e) { toast(e.message, 'err'); } el.disabled = false; },
  async movebatch(a) { const m = structuredClone(getMember(a.id)), to = m.batch === 'Morning' ? 'Evening' : 'Morning'; m.logs.push({ at: Date.now(), text: `Batch ${m.batch} → ${to}` }); m.batch = to; await saveMember(m); toast(`Moved to ${to} batch`); },
  async delmember(a) { const m = getMember(a.id); if (confirm(`Delete ${m.name} permanently, including payment history? This cannot be undone.`)) { await deleteDoc(mref(a.id)); toast('Member deleted'); location.hash = '#/members'; } },
  tabbatch(a) { S.batchTab = a.b; if (S.route === 'batches') vBatches(); },
  takephoto() { isTouch ? $('#camIn').click() : openWebcam(); },
  choosephoto: () => $('#fileIn').click(),
  rmphoto: () => setPhoto(''),
  snap,
  addplanrow() { $('#planrows').insertAdjacentHTML('beforeend', planRow({ id: uid(), name: '', days: 30, price: 0 })); $('#planrows .planrow:last-child input')?.focus(); },
  rmplanrow(a, el) { el.closest('.planrow').remove(); },
  resettpl() { $('[name=template]').value = DEFAULT_TEMPLATE; },
  rmpin() { localStorage.removeItem('gm_pin'); toast('PIN turned off'); vSettings(); },
  dlmembers: () => exportCSV('members'), dlpayments: () => exportCSV('payments'), dlrenewals: () => exportCSV('renewals'),
  dlbackup() { download(`gym-backup-${stamp()}.json`, JSON.stringify(makeBackup()), 'application/json'); exportCSV('members'); exportCSV('payments'); exportCSV('renewals'); },
  async backupnow(a, el) { el.disabled = true; try { await autoBackup(); toast('Backup saved ☁️'); } catch (e) { toast(errMsg(e), 'err'); } el.disabled = false; },
  restorefile: () => $('#restoreIn').click(),
  async restorecloud() {
    try { const { id, obj } = await latestCloudBackup(); if (confirm(`Restore the cloud backup from ${id} (${obj.members.length} members)? Same-ID members will be overwritten.`)) { await restoreData(obj); toast('Restore complete ✅'); } }
    catch (e) { toast(e.message, 'err'); }
  },
  walltomorrow() { walList = L().filter((x) => x.i.left === 1); walIdx = 0; walStep(); },
  walnext() { walIdx++; setTimeout(walStep, 250); },
};
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const fn = actions[el.dataset.act]; if (!fn) return;
  // let real links (WhatsApp / tel) work normally; still run side-effect actions
  if (el.tagName === 'A' && el.dataset.act !== 'tabbatch' && el.getAttribute('href') === null) e.preventDefault();
  fn(el.dataset, el, e);
});
document.addEventListener('submit', (e) => {
  const f = e.target.closest('form[data-form]'); if (!f) return;
  e.preventDefault();
  Promise.resolve(formHandlers[f.dataset.form]?.(f)).catch((err) => { busy(f, false); showErr(f, errMsg(err)); });
});
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'q') { S.q = t.value; drawMembers(); }
  else if (t.id === 'fPlan') { S.fPlan = t.value; drawMembers(); }
  else if (t.id === 'fBatch') { S.fBatch = t.value; drawMembers(); }
  else if (t.id === 'fStatus') { S.fStatus = t.value; drawMembers(); }
  else if (t.id === 'rmonth' && t.value) { S.rmonth = t.value; vReports(); }
  else if (t.closest('#mform')) updateAddPreview(t.name === 'plan' || t.name === 'discount' || t.name === 'joinDate' ? t.name !== 'joinDate' : false);
});
