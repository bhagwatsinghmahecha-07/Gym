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
  onSnapshot, getDocs, writeBatch, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { firebaseConfig } from '../firebase-config.js';
import {
  $, $$, esc, money, uid, todayStr, addDays, diffDays, fmtDate, calcPeriod, curRenewal, memberInfo, SOON_DAYS, daysBadge, daysText,
  brandHtml, statusBadge, normPhone, validPhone, waLink, fmtMsg, csv, download, compressImage,
} from './util.js';
import { invoiceData, printInvoice, invoiceBlob, shareInvoiceWhatsApp, renderInvoicePages } from './invoice.js';

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
const DEFAULT_EXPIRED_TEMPLATE =
  'Hello {name}, your {plan} gym membership expired on {date}. We miss you at the gym! Renew now to get back to your workouts. - {gym}';
const DEFAULT_WELCOME_TEMPLATE =
  'Welcome to {gym}, {name}! Your {plan} membership is active from {start} to {date}. We are glad to have you with us. See you at the gym! - {gym}';
const DEF_SETTINGS = { gymName: 'My Gym', ownerName: '', phone: '', email: '', plans: DEFAULT_PLANS, template: DEFAULT_TEMPLATE, expiredTemplate: DEFAULT_EXPIRED_TEMPLATE, welcomeTemplate: DEFAULT_WELCOME_TEMPLATE, logo: '', terms: '', rules: '', invSeq: 0 };

const S = {
  user: null, role: 'owner', ownerId: '', staff: null, staffList: [], settings: { ...DEF_SETTINGS }, members: [], ready: { s: false, m: false }, shell: false,
  route: '', arg: '', sort: { k: 'due', d: 1 }, q: '', fPlan: '', fBatch: '', fStatus: '', fJoin: false, mTab: 'active', batchTab: 'Morning',
  rmonth: todayStr().slice(0, 7), photo: '', rTab: 'soon',
};
let unsubs = [];
const isTouch = matchMedia('(pointer:coarse)').matches;
const uidOf = () => S.ownerId || S.user.uid;
const mref = (id) => doc(db, 'gyms', uidOf(), 'members', id);
const sref = () => doc(db, 'gyms', uidOf(), 'settings', 'main');
const saveSettings = (patch) => setDoc(sref(), patch, { merge: true });
const cleanMember = (m) => { const o = JSON.parse(JSON.stringify(m)); delete o.createdMs; return o; };
// merge keeps server-only fields (like the trainer edit-window timestamp) in place
const saveMember = (m) => setDoc(mref(m.id), cleanMember(m), { merge: true });
const saveNewMember = (m) => setDoc(mref(m.id), isTrainer() ? { ...cleanMember(m), createdAtTs: serverTimestamp() } : cleanMember(m));
// ---- roles: the owner can do everything; a trainer has a limited set of actions (also enforced by firestore.rules)
const isTrainer = () => S.role === 'trainer';
const actorName = () => (isTrainer() ? (S.staff?.name || 'Trainer') : 'Owner');
const byTag = () => ({ by: actorName(), byId: S.user?.uid || '' });
const logEntry = (text) => ({ at: Date.now(), text, ...byTag() });
const canSeeHealth = () => !isTrainer() || !!S.staff?.canSeeHealth;
const EDIT_WINDOW = 10 * 60e3;
const editLeft = (m) => (m.addedByUid === S.user?.uid && m.createdMs ? m.createdMs + EDIT_WINDOW - Date.now() : 0);
const canEdit = (m) => !isTrainer() || editLeft(m) > 0;
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
      <div class="links tr-link"><span class="mut">Are you a trainer?</span><button class="linkbtn" data-act="auth" data-to="trainer">Create your trainer login</button></div>
`,
    trainer: `<p>Trainer sign-up</p><div class="note">Use the email address your gym owner added for you. We will send a verification link to it.</div>
      <form data-form="tsignup"><label>Your email<input name="email" type="email" required autocomplete="email" placeholder="you@gmail.com"></label>
        <div class="grid2">${pwField('pw', 'Create password (min 8)', 'new-password')}${pwField('pw2', 'Confirm password', 'new-password')}</div>
        <div class="err hide" data-err></div>
        <button class="btn primary block" type="submit">Create trainer login</button></form>
      <div class="links"><button class="linkbtn" data-act="auth" data-to="login">← Back to login</button></div>`,
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
  root.innerHTML = `<div class="auth"><div class="auth-card"><div class="auth-banner"><img src="/icons/logo.png" alt="Fitness Club"></div><div class="brand bname">${brandHtml('Fitness Club')}</div>${forms[mode]}</div></div>`;
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
  async tsignup(f) {
    const d = Object.fromEntries(new FormData(f)), email = d.email.trim();
    if (d.pw.length < 8) return showErr(f, 'Password must be at least 8 characters.');
    if (d.pw !== d.pw2) return showErr(f, 'Passwords do not match.');
    busy(f, true); showErr(f, '');
    S.signingUp = true;
    const done = () => { busy(f, false); setTimeout(() => { S.signingUp = false; }, 900); };
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, d.pw);
      let invited = false;
      try { invited = (await getDoc(doc(db, 'staffIndex', email.toLowerCase()))).exists(); } catch { invited = false; }
      if (!invited) {
        await cred.user.delete().catch(() => signOut(auth));
        done();
        return showErr(f, 'This email has not been invited yet. Please ask the gym owner to add your email on the Staff page, then try again.');
      }
      sendEmailVerification(cred.user).catch(() => {});
      localStorage.setItem('gm_remember', '1');
      done();
      S.user = cred.user; enter(cred.user);
    } catch (e) { done(); showErr(f, errMsg(e)); }
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
  $('#lock').innerHTML = `<div class="lockov"><div class="auth-card"><div class="auth-banner"><img src="/icons/logo.png" alt="Fitness Club"></div><div class="brand bname">${brandHtml('Fitness Club')}</div><h3 style="margin:0 0 4px">🔒 Enter PIN</h3><p>Enter your 4-digit app PIN</p>
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

// Shown to a trainer who still has to verify their email, or whose access was switched off
function noticeScreen(title, html) {
  S.shell = false;
  root.innerHTML = `<div class="auth"><div class="auth-card"><div class="auth-banner"><img src="/icons/logo.png" alt="Fitness Club"></div><div class="brand bname">${brandHtml('Fitness Club')}</div><h3>${title}</h3>${html}</div></div>`;
}
const verifyScreen = () => noticeScreen('Verify your email', `<p>We sent a verification link to <b>${esc(S.user.email)}</b>. Open it, then come back here and tap the button.</p>
  <button class="btn primary block" data-act="verified">I have verified my email</button>
  <div class="links"><button class="linkbtn" data-act="resendverify">Resend email</button><button class="linkbtn" data-act="logout">Log out</button></div>`);
function noAccessScreen() {
  unsubs.forEach((u) => u()); unsubs = []; S.ready = { s: false, m: false };
  noticeScreen('No access', `<p>Your trainer access is switched off or was removed. Please contact the gym owner.</p><div class="links"><button class="linkbtn" data-act="logout">← Log out</button></div>`);
}

function startSession(user) {
  // On a page refresh the first read can reach the database before the restored sign-in token is attached
  // ("permission-denied"). Refresh the token and re-subscribe quietly; only show an error if it keeps failing.
  const listen = (q, next, tries = 0) => {
    unsubs.push(onSnapshot(q, next, async (e) => {
      if (e.code === 'permission-denied' && tries < 3 && S.user && S.user.uid === user.uid) {
        try { await user.getIdToken(true); } catch { /* ignore */ }
        setTimeout(() => { if (S.user && S.user.uid === user.uid) listen(q, next, tries + 1); }, 700 * (tries + 1));
        return;
      }
      if (isTrainer() && e.code === 'permission-denied') return noAccessScreen();
      toast(errMsg(e), 'err');
    }));
  };
  listen(sref(), (snap) => { S.settings = { ...DEF_SETTINGS, ...(snap.data() || {}) }; S.ready.s = true; afterData(); });
  listen(collection(db, 'gyms', uidOf(), 'members'), (snap) => {
    S.members = snap.docs.map((d) => {
      const m = { id: d.id, ...d.data({ serverTimestamps: 'estimate' }) };
      if (m.createdAtTs?.toMillis) m.createdMs = m.createdAtTs.toMillis();
      delete m.createdAtTs;
      m.renewals ||= []; m.payments ||= []; m.logs ||= [];
      return m;
    }).filter((m) => m.renewals.length);
    S.ready.m = true; afterData();
  });
  if (!isTrainer()) listen(collection(db, 'gyms', uidOf(), 'staff'), (snap) => { S.staffList = snap.docs.map((d) => ({ key: d.id, ...d.data() })); if (S.route === 'staff') vStaff(); });
  showLock();
}

// Who is this? A trainer's email is listed in "staffIndex" (written by the owner when inviting them); everyone else is the owner.
async function enter(user) {
  S.role = 'owner'; S.ownerId = ''; S.staff = null;
  root.innerHTML = '<div class="splash"><img src="/icons/logo-emblem.png" alt=""><div>Loading your gym…</div></div>';
  const key = (user.email || '').toLowerCase(), ck = 'gm_role_' + user.uid;
  let idx = null, known = false;
  try { const sn = await getDoc(doc(db, 'staffIndex', key)); known = true; if (sn.exists()) idx = sn.data(); } catch { /* offline: use what this device remembered */ }
  if (S.user !== user) return;
  if (known) localStorage.setItem(ck, idx ? JSON.stringify({ o: idx.ownerId }) : 'owner');
  else { const c = localStorage.getItem(ck); if (c && c !== 'owner') { try { idx = { ownerId: JSON.parse(c).o }; } catch { /* ignore */ } } }
  if (idx) {
    S.role = 'trainer'; S.ownerId = idx.ownerId;
    if (!user.emailVerified) return verifyScreen();
    try {
      const sd = await getDoc(doc(db, 'gyms', idx.ownerId, 'staff', key));
      if (S.user !== user) return;
      if (!sd.exists() || sd.data().active === false) return noAccessScreen();
      S.staff = sd.data();
    } catch (e) {
      if (e.code === 'permission-denied') return noAccessScreen();
      S.staff = { name: 'Trainer' }; // offline: carry on with what is cached
    }
  }
  startSession(user);
}

onAuthStateChanged(auth, (user) => {
  unsubs.forEach((u) => u()); unsubs = []; bootDone = false;
  S.shell = false; S.members = []; S.ready = { s: false, m: false }; S.settings = { ...DEF_SETTINGS };
  S.role = 'owner'; S.ownerId = ''; S.staff = null; S.staffList = [];
  S.user = user;
  if (S.signingUp) return; // trainer sign-up is checking the invitation first
  if (!user) { $('#lock').innerHTML = ''; return authScreen(new URLSearchParams(location.search).has('setup') ? 'signup' : 'login'); }
  if (inactiveTooLong()) { signOut(auth); return; }
  touchActivity();
  enter(user);
});

let bootDone = false;
function afterData() {
  if (!S.ready.s || !S.ready.m) return;
  if (!bootDone) { bootDone = true; setTimeout(boot, 1500); }
  refresh();
}
async function boot() {
  bootDone = true;
  if (isTrainer()) { setDoc(doc(db, 'gyms', uidOf(), 'staff', (S.user.email || '').toLowerCase()), { lastSeenAt: Date.now(), uid: S.user.uid }, { merge: true }).catch(() => {}); return; }
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
  back: '<path d="M15 5l-7 7 7 7"/>',
  dumbbell: '<path d="M6.5 6.5v11M17.5 6.5v11M3 9v6M21 9v6M6.5 12h11"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  rupee: '<path d="M6 4h12M6 9h12M9 4c5 0 6 5 0 5l7 11"/>',
  userplus: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M19 8v6M16 11h6"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.1"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>',
  x: '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  refresh: '<path d="M20 11a8 8 0 00-14-4L4 9"/><path d="M4 4v5h5"/><path d="M4 13a8 8 0 0014 4l2-2"/><path d="M20 20v-5h-5"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A15 15 0 013 6a2 2 0 012-2z"/>',
  whatsapp: '<path d="M3 21l1.7-5A9 9 0 1112 21a9 9 0 01-4.3-1.1z"/><path d="M9 9c0 3.5 2.5 6 6 6l1-1.5-2-1-1 .8a4 4 0 01-2-2l.8-1-1-2z"/>',
  dots: '<circle cx="12" cy="5" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="12" cy="19" r="1.3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  swap: '<path d="M4 8h14l-3-3"/><path d="M20 16H6l3 3"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/>',
};
const ic = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ''}</svg>`;
const NAV = [
  ['dashboard', 'home', 'Dashboard'], ['members', 'users', 'Members'], ['reminders', 'bell', 'Reminders'],
  ['batches', 'clock', 'Batches'], ['dues', 'wallet', 'Payments & Dues'], ['reports', 'chart', 'Reports'], ['staff', 'userplus', 'Trainers'], ['settings', 'gear', 'Settings'],
];
const TNAV = [['dashboard', 'home', 'Dashboard', '#/dashboard'], ['members', 'users', 'Members', '#/members'], ['duelist', 'wallet', 'Pending Dues', '#/duelist/renewal']];
const TRAINER_ROUTES = ['dashboard', 'members', 'member', 'add', 'edit', 'duelist'];
function renderShell() {
  const logo = `<img class="logo-img" src="/icons/logo-emblem.png" alt="">`;
  root.innerHTML = `<div class="shell">
    <aside class="side"><div class="brand"><img class="side-logo" src="/icons/logo.png" alt="Fitness Club"></div>
      <nav>${(isTrainer() ? TNAV : NAV).map(([r, i, l, h]) => `<button class="navbtn ${(isTrainer() ? ['dashboard', 'members', 'duelist'] : ['dashboard', 'members', 'reminders']).includes(r) ? 'dup' : ''}" data-act="go" data-to="${h || '#/' + r}" data-r="${r}">${ic(i)}<span>${l}</span><i class="pip hide" data-pip="${r}"></i></button>`).join('')}</nav>
      ${isTrainer() ? `<div class="whoami"><b>${esc(actorName())}</b><span>Trainer</span></div>` : ''}
      <button class="navbtn" data-act="logout">${ic('logout')}<span>Logout</span></button></aside>
    <div class="main">
      <header class="topbar"><div class="tb-brand">${logo}<b class="bname" data-gym></b></div><button class="iconbtn" data-act="logout" aria-label="Logout">${ic('logout')}</button></header>
      <nav class="toptabs" aria-label="Main">
        <button class="ttab" data-act="go" data-to="#/dashboard" data-r="dashboard">${ic('home')}<span>Home</span></button>
        <button class="ttab" data-act="go" data-to="#/members" data-r="members">${ic('users')}<span>Members</span></button>
        ${isTrainer() ? `<button class="ttab" data-act="go" data-to="#/duelist/renewal" data-r="duelist">${ic('wallet')}<span>Dues</span></button>` : `<button class="ttab" data-act="go" data-to="#/reminders" data-r="reminders">${ic('bell')}<span>Reminders</span><i class="pip hide" data-pip="reminders"></i></button>`}
        <button class="ttab more" data-act="more">${ic('menu')}<span>More</span></button></nav>
      <div class="pagehead"><button class="backbtn hide" data-act="back" aria-label="Go back">${ic('back')}<span>Back</span></button><h1 id="title"></h1></div>
      <div id="banner"></div><main id="view"></main></div>
    <button class="fab" data-act="go" data-to="#/add" aria-label="Add member" title="Add member">${ic('plus')}</button></div>`;
  S.shell = true;
}
function updateChrome() {
  $$('[data-gym]').forEach((e) => (e.innerHTML = brandHtml(S.settings.gymName)));
  const soon = S.members.filter((m) => { const l = memberInfo(m).left; return l >= 0 && l <= SOON_DAYS; }).length + S.members.filter(isWelcome).length;
  $$('[data-pip=reminders]').forEach((e) => { e.textContent = soon; e.classList.toggle('hide', !soon); });
  $$('[data-r]').forEach((b) => b.classList.toggle('on', b.dataset.r === S.route || (S.route === 'member' && b.dataset.r === 'members') || (S.route === 'duelist' && b.dataset.r === 'dashboard' && !isTrainer()) || (S.route === 'edit' && b.dataset.r === 'members')));
  $('.fab')?.classList.toggle('hide', S.route === 'add' || S.route === 'edit');
  $('.backbtn')?.classList.toggle('hide', S.route === 'dashboard');
  $('#banner').innerHTML = S.user && !S.user.emailVerified ? `<div class="verify">📧 Please verify your email (check your inbox). <button class="linkbtn" data-act="resendverify">Resend email</button></div>` : '';
}
const setTitle = (t) => { $('#title').textContent = t; document.title = t + ' · ' + S.settings.gymName; };
const view = (html) => ($('#view').innerHTML = html);

const routes = { dashboard: vDashboard, members: vMembers, member: vMember, add: vForm, edit: vForm, reminders: vReminders, batches: vBatches, dues: vDues, duelist: vDueList, reports: vReports, staff: vStaff, settings: vSettings };
const LIVE = ['dashboard', 'reminders', 'batches', 'dues', 'duelist', 'reports', 'member', 'staff'];
// our own page history so the Back button works inside the installed app too
const navStack = [];
const resetFilters = () => { S.q = ''; S.fPlan = ''; S.fBatch = ''; S.fStatus = ''; S.fJoin = false; S.mTab = 'active'; };
function route(keepScroll) {
  if (!S.user || !S.ready.s || !S.ready.m) return;
  if (!S.shell) renderShell();
  const [name, arg] = (location.hash.slice(2) || 'dashboard').split('/');
  S.route = routes[name] ? name : 'dashboard'; S.arg = arg;
  if (isTrainer() && !TRAINER_ROUTES.includes(S.route)) { location.replace('#/dashboard'); return; } // trainers only get their own screens
  if (!keepScroll && S.route !== 'add' && S.route !== 'edit') {
    const h = location.hash || '#/dashboard', k = navStack.lastIndexOf(h);
    if (k >= 0) navStack.length = k + 1; else navStack.push(h);
    if (navStack.length > 40) navStack.shift();
  }
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
setInterval(() => { if (isTrainer() && S.shell && S.route === 'member') route(true); }, 30000); // keeps the edit countdown fresh

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
// WhatsApp message depends on the member's stage:
//   first day after joining (welcome not sent yet) -> welcome | more than 5 days left -> no message
//   5 days or less left -> renewal reminder | expired up to 2 days -> expired message | expired longer -> no message
const isWelcome = (m) => { const d = diffDays(todayStr(), m.joinDate); return !m.welcomeSent && d >= 0 && d <= 1; };
const stageOf = (m, i) => (isWelcome(m) ? 'welcome' : i.left < 0 ? (i.left >= -RENEW_GRACE ? 'expired' : 'none') : i.left <= SOON_DAYS ? 'soon' : 'none');
const msgFor = (m, i) => {
  const tpl = { welcome: S.settings.welcomeTemplate || DEFAULT_WELCOME_TEMPLATE, expired: S.settings.expiredTemplate || DEFAULT_EXPIRED_TEMPLATE, soon: S.settings.template }[stageOf(m, i)];
  return tpl ? fmtMsg(tpl, { name: m.name, plan: i.c.planName, start: fmtDate(i.c.start), date: fmtDate(i.c.due), gym: S.settings.gymName }) : '';
};
const waFor = (m, i) => waLink(m.phone, msgFor(m, i));
// WhatsApp button: becomes "Send welcome" (and marks the welcome as sent) during the first day
const waBtn = (m, i, cls = 'mp-btn wa') => { const w = isWelcome(m); return `<a class="${cls}" href="${waFor(m, i)}" target="_blank" rel="noopener"${w ? ` data-act="welcomesent" data-id="${m.id}"` : ''}>${ic('whatsapp')}${w ? 'Send welcome' : 'WhatsApp'}</a>`; };
async function markWelcome(id, text) {
  const m = structuredClone(getMember(id)); if (!m || m.welcomeSent) return;
  m.welcomeSent = true; m.logs.push(logEntry(text));
  try { await saveMember(m); } catch (e) { toast(errMsg(e), 'err'); }
}
function offerWelcome(m) {
  if (!isWelcome(m)) return;
  const i = memberInfo(m);
  openModal('Member added', `<div class="head" style="margin-bottom:12px">${avatar(m, true)}<div class="grow"><h3>${esc(m.name)}</h3><div class="mut">${esc(i.c.planName)} · due ${fmtDate(i.c.due)}</div></div></div>
    <div class="sm mut" style="margin-bottom:6px">Welcome message</div><div class="preview">${esc(msgFor(m, i))}</div>
    <div class="actions"><a class="btn green" href="${waFor(m, i)}" target="_blank" rel="noopener" data-act="welcomesent" data-id="${m.id}">Send welcome on WhatsApp</a><button class="btn" data-act="closemodal">Later</button></div>`);
}
const empty = (t) => `<div class="card mut" style="text-align:center">${t}</div>`;

// ------------------------------------------------------------------ DASHBOARD
function vDashboard() {
  setTitle('Dashboard');
  const list = L(), month = todayStr().slice(0, 7);
  const active = list.filter((x) => x.i.status !== 'expired');
  const soon = list.filter((x) => x.i.left >= 0 && x.i.left <= SOON_DAYS).length;
  const tr = isTrainer();
  const revenue = tr ? 0 : S.members.flatMap((m) => m.payments).filter((p) => p.date.startsWith(month)).reduce((a, p) => a + p.amount, 0);
  const joins = S.members.filter((m) => m.joinDate.startsWith(month)).length;
  const dg = dueGroups();
  const planNames = [...new Set([...S.settings.plans.map((p) => p.name), ...active.map((x) => x.i.c.planName)])];
  const cnt = (b) => active.filter((x) => x.m.batch === b).length;
  const hr = new Date().getHours(), greet = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
  const stat = (icon, tone, label, val, href, attrs = '', sub = '') => `<${href ? `a href="${href}" ${attrs}` : 'div'} class="stat ${tone}"><span class="si">${ic(icon)}</span><div><div class="l">${label}</div><b>${val}</b>${sub ? `<div class="l">${sub}</div>` : ''}</div></${href ? 'a' : 'div'}>`;
  view(`<section class="hero"><div><div class="hero-sub">${greet}${(tr ? actorName() : S.settings.ownerName) ? ', ' + esc((tr ? actorName() : S.settings.ownerName).split(' ')[0]) : ''} 👋</div>
      <div class="hero-t bname">${brandHtml(S.settings.gymName)}</div><div class="hero-d">${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div></div>
      ${tr ? `<div class="hero-n"><div class="l">Logged in as</div><b class="who">${esc(actorName())}</b><div class="l">Trainer</div></div>` : `<a class="hero-n" href="#/reports"><div class="l">This month's revenue ›</div><b>${money(revenue)}</b></a>`}</section>
    <div class="quick">${tr ? `<a class="btn" href="#/add">${ic('plus')} Add Member</a><a class="btn" href="#/duelist/renewal">${ic('wallet')} Pending Dues</a>` : `<a class="btn" href="#/reminders">${ic('bell')} Reminders</a><a class="btn" href="#/dues">${ic('wallet')} Collect Payment</a>`}</div>
    <div class="stats">
      ${stat('users', 'tone-blue', 'Total members', list.length, '#/members', 'data-act="filt"')}
      ${stat('check', 'tone-green', 'Active', active.length, '#/members', 'data-act="filt" data-st="live"')}
      ${stat('x', 'tone-red', 'Expired', list.length - active.length, '#/members', 'data-act="filt" data-st="expired"')}
      ${stat('bell', 'tone-orange', 'Expiring soon', soon, tr ? '#/duelist/renewal' : '#/reminders')}
      ${stat('userplus', 'tone-violet', 'New joinings', joins, '#/members', 'data-act="filt" data-join="1"')}
      ${stat('rupee', 'tone-red', 'Renewal dues', money(dg.rTotal), '#/duelist/renewal', '', `${dg.renewal.length} member${dg.renewal.length === 1 ? '' : 's'}`)}
      ${stat('wallet', 'tone-orange', 'Unpaid balance', money(dg.uTotal), '#/duelist/unpaid', '', `${dg.unpaid.length} member${dg.unpaid.length === 1 ? ' still owes' : 's still owe'} money`)}</div>
    <div class="dash"><div><h2>Active members by plan</h2><div class="card">${planNames.map((n) => `<a class="kv" href="#/members" data-act="filt" data-st="live" data-plan="${esc(n)}"><span>${esc(n)}</span><b>${active.filter((x) => x.i.c.planName === n).length} ›</b></a>`).join('') || '<span class="mut">No plans yet</span>'}</div></div>
    <div><h2>Active members by batch</h2><div class="card">
      ${tr ? `<div class="kv"><span>☀️ Morning batch</span><b>${cnt('Morning')}</b></div><div class="kv"><span>🌙 Evening batch</span><b>${cnt('Evening')}</b></div>`
        : `<a class="kv" href="#/batches" data-act="tabbatch" data-b="Morning"><span>☀️ Morning batch</span><b>${cnt('Morning')}</b></a>
      <a class="kv" href="#/batches" data-act="tabbatch" data-b="Evening"><span>🌙 Evening batch</span><b>${cnt('Evening')}</b></a>`}</div></div></div>`);
}

// ------------------------------------------------------------------ MEMBERS list
function vMembers() {
  setTitle('Members');
  const opt = (arr, v) => arr.map(([val, l]) => `<option value="${val}" ${val === v ? 'selected' : ''}>${l}</option>`).join('');
  view(`<div class="bar"><div class="mut">Search, filter and manage your members</div><button class="btn primary" data-act="go" data-to="#/add">${ic('plus')} Add Member</button></div>
    <div class="toolbar"><input id="q" type="search" placeholder="${isTrainer() ? 'Search by name' : 'Search name or phone'}" value="${esc(S.q)}">
    <select id="fPlan"><option value="">All plans</option>${opt(S.settings.plans.map((p) => [p.name, p.name]), S.fPlan)}</select>
    <select id="fBatch"><option value="">All batches</option>${opt([['Morning', 'Morning'], ['Evening', 'Evening']], S.fBatch)}</select>
</div>
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
  const base = L().filter((x) =>
    (!q || x.m.name.toLowerCase().includes(q) || (!isTrainer() && x.m.phone.includes(q.replace(/\D/g, '') || '§'))) &&
    (!S.fPlan || x.i.c.planName === S.fPlan) && (!S.fBatch || x.m.batch === S.fBatch) && (!S.fJoin || x.m.joinDate.startsWith(todayStr().slice(0, 7))));
  // Active and Expired are kept in separate lists (tabs). "New joinings" shows everyone who joined this month in one list.
  const nAct = base.filter((x) => x.i.status !== 'expired').length, nExp = base.length - nAct;
  const tabs = S.fJoin ? '' : `<div class="seg"><button class="${S.mTab === 'active' ? 'on' : ''}" data-act="mtab" data-t="active">Active (${nAct})</button><button class="${S.mTab === 'expired' ? 'on' : ''}" data-act="mtab" data-t="expired">Expired (${nExp})</button></div>`;
  let list = S.fJoin ? base : base.filter((x) => (S.mTab === 'expired' ? x.i.status === 'expired' : x.i.status !== 'expired'));
  const chips = (q || S.fPlan || S.fBatch || S.fJoin) ? `<div class="chips">${S.fJoin ? '<span class="badge blue">New joinings (this month)</span>' : ''}<button class="btn sm" data-act="clearfilters">✕ Clear filters</button></div>` : '';
  const f = SORT_KEYS[S.sort.k];
  list.sort((a, b) => (f(a) > f(b) ? 1 : f(a) < f(b) ? -1 : 0) * S.sort.d);
  if (!list.length) return (box.innerHTML = tabs + chips + empty(S.members.length ? (S.fJoin ? 'Nobody has joined this month yet.' : S.mTab === 'expired' && !q && !S.fPlan && !S.fBatch ? 'No expired members 🎉' : 'No members match your search/filters.') : 'No members yet. Tap <b>＋ Add Member</b> to add your first one.'));
  const th = (k, l) => `<th data-act="sort" data-k="${k}">${l}${S.sort.k === k ? (S.sort.d > 0 ? ' ▲' : ' ▼') : ''}</th>`;
  box.innerHTML = `${tabs}${chips}<div class="mut sm" style="margin-bottom:8px">${list.length} member${list.length > 1 ? 's' : ''}</div>
  <div class="cards-only">${list.map(({ m, i }) => `<div class="mcard" data-act="open" data-id="${m.id}">${avatar(m)}<div class="info"><div class="nm">${esc(m.name)}</div>
    <div class="sm mut">${isTrainer() ? '' : esc(m.phone) + ' · '}${esc(i.c.planName)} · ${m.batch}</div><div class="sm mut">Due ${fmtDate(i.c.due)}</div>
    <div class="row2">${daysBadge(i.left)}${i.balance ? `<span class="badge red">Due ${money(i.balance)}</span>` : ''}${m.health && canSeeHealth() ? '<span class="badge orange" title="Health note added">Health note</span>' : ''}</div></div></div>`).join('')}</div>
  <div class="table-only tablewrap"><table><thead><tr><th>Photo</th>${th('name', 'Name')}${isTrainer() ? '' : th('phone', 'Phone')}${th('plan', 'Plan')}${th('batch', 'Batch')}${th('start', 'Start')}${th('due', 'Due date')}${th('left', 'Days left')}${th('status', 'Status')}${th('dues', 'Pending')}</tr></thead>
  <tbody>${list.map(({ m, i }) => `<tr class="clickable" data-act="open" data-id="${m.id}"><td>${avatar(m)}</td><td><b>${esc(m.name)}</b>${m.health && canSeeHealth() ? ' <span class="badge orange" title="Health note added">Health</span>' : ''}</td>${isTrainer() ? '' : `<td>${esc(m.phone)}</td>`}<td>${esc(i.c.planName)}</td><td>${m.batch}</td><td>${fmtDate(i.c.start)}</td><td>${fmtDate(i.c.due)}</td><td>${daysBadge(i.left)}</td><td>${statusBadge(i.status)}</td><td>${i.balance ? `<b style="color:var(--red)">${money(i.balance)}</b>` : '-'}</td></tr>`).join('')}</tbody></table></div>`;
}

// ------------------------------------------------------------------ health & fitness helpers
const GOALS = ['Weight loss', 'Muscle gain', 'General fitness', 'Strength', 'Stamina', 'Other'];
const kgTxt = (n) => (Math.round(n * 10) / 10) + ' kg';
const bmiOf = (kg, cm) => (kg > 0 && cm > 0 ? kg / ((cm / 100) ** 2) : 0);
const bmiInfo = (b) => (b < 18.5 ? ['Underweight', 'blue'] : b < 25 ? ['Normal', 'green'] : b < 30 ? ['Overweight', 'orange'] : ['Obese', 'red']);
const goalOf = (m) => (m.goal === 'Other' ? (m.goalOther || 'Other') : m.goal || '');
function syncWeight(m) {
  m.weights = (m.weights || []).slice().sort((x, y) => (x.date > y.date ? 1 : x.date < y.date ? -1 : (x.at || 0) - (y.at || 0)));
  m.weight = m.weights.length ? m.weights[m.weights.length - 1].kg : '';
}
function sparkline(ws) {
  if (ws.length < 2) return '';
  const W = 300, H = 70, P = 8, ys = ws.map((w) => w.kg), lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || 1;
  const pts = ws.map((w, i) => [P + (i * (W - 2 * P)) / (ws.length - 1), H - P - ((w.kg - lo) / span) * (H - 2 * P)]);
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts.map((p) => p.join(',')).join(' ')}" fill="none" stroke="#0877d1" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>${pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="${i === pts.length - 1 ? 5 : 3.5}" fill="${i === pts.length - 1 ? '#fab706' : '#0877d1'}"/>`).join('')}</svg>`;
}
function healthCards(m, mayEdit = true) {
  const ws = [...(m.weights || [])].sort((x, y) => (x.date > y.date ? 1 : x.date < y.date ? -1 : (x.at || 0) - (y.at || 0)));
  const kg = +m.weight || 0, cm = +m.height || 0, b = bmiOf(kg, cm), bi = b ? bmiInfo(b) : null, goal = goalOf(m);
  const any = kg || cm || goal || m.health;
  const tile = (l, v, extra = '') => `<div class="hf-tile"><small>${l}</small><b>${v}</b>${extra}</div>`;
  const good = (diff) => (m.goal === 'Weight loss' ? diff < 0 : m.goal === 'Muscle gain' ? diff > 0 : null);
  const rows = ws.map((w, i) => {
    const d = i ? Math.round((w.kg - ws[i - 1].kg) * 10) / 10 : null;
    const g = d === null || d === 0 ? null : good(d);
    const chg = d === null ? '<span class="mut">Start</span>' : d === 0 ? '<span class="mut">No change</span>' : `<b class="${g === true ? 'wt-good' : g === false ? 'wt-bad' : ''}">${d < 0 ? '▼' : '▲'} ${Math.abs(d)} kg</b>`;
    return `<tr><td>${fmtDate(w.date)}</td><td><b>${kgTxt(w.kg)}</b></td><td>${chg}</td><td style="text-align:right">${mayEdit ? `<button class="btn sm" data-act="delweight" data-id="${m.id}" data-w="${w.id}" aria-label="Delete this weight entry">${ic('trash')}</button>` : ''}</td></tr>`;
  }).reverse().join('');
  const tot = ws.length > 1 ? Math.round((ws[ws.length - 1].kg - ws[0].kg) * 10) / 10 : null;
  return `<h2>Health &amp; fitness</h2><div class="card">
    ${any ? `<div class="hf-tiles">${tile('Weight', kg ? kgTxt(kg) : '-')}${tile('Height', cm ? cm + ' cm' : '-')}${tile('BMI', b ? b.toFixed(1) : '-', bi ? `<span class="badge ${bi[1]}">${bi[0]}</span>` : '')}</div>
      <div class="hf-line"><span class="mut">Goal</span>${goal ? `<span class="goal-tag">${esc(goal)}</span>` : '<b>-</b>'}</div>
      ${m.health ? `<div class="hf-note"><b>Health note</b><span>${esc(m.health)}</span></div>` : '<div class="hf-line"><span class="mut">Health issues</span><b>None noted</b></div>'}`
      : `<div class="mut" style="padding:6px 0">No health details added yet.</div>`}
    ${mayEdit ? `<button class="btn block" style="margin-top:12px" data-act="go" data-to="#/edit/${m.id}">${ic('edit')} Edit health details</button>` : ''}</div>
  <h2>Weight progress</h2><div class="card">
    ${ws.length ? `${sparkline(ws)}${tot !== null ? `<div class="hf-line" style="margin-top:6px"><span class="mut">Since ${fmtDate(ws[0].date)}</span><b class="${good(tot) === true ? 'wt-good' : good(tot) === false ? 'wt-bad' : ''}">${tot === 0 ? 'No change' : (tot < 0 ? '▼ ' : '▲ ') + Math.abs(tot) + ' kg'}</b></div>` : ''}
      <div class="tablewrap"><table class="wt-table"><thead><tr><th>Date</th><th>Weight</th><th>Change</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="mut" style="padding:6px 0">No weight recorded yet.</div>'}
    ${mayEdit ? `<button class="btn primary block" style="margin-top:12px" data-act="addweight" data-id="${m.id}">${ic('plus')} Add new weight</button>` : ''}</div>`;
}

// ------------------------------------------------------------------ MEMBER profile
function vMember(id) {
  const m = getMember(id);
  if (!m) { location.hash = '#/members'; return; }
  const i = memberInfo(m), tr = isTrainer(), mayEdit = canEdit(m);
  setTitle(m.name);
  const rens = [...m.renewals].reverse(), pays = [...m.payments].reverse();
  const total = Math.max(1, diffDays(i.c.due, i.c.start)), used = Math.min(100, Math.max(0, Math.round((diffDays(todayStr(), i.c.start) / total) * 100)));
  const mins = Math.max(1, Math.ceil(editLeft(m) / 60000));
  const stampTxt = (t) => (t ? new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
  const addedLine = m.addedBy ? `<div class="mp-by">Added by <b>${esc(m.addedBy)}</b>${m.createdAt ? ' · ' + stampTxt(m.createdAt) : ''}</div>` : '';
  const who = (x) => (x.by ? esc(x.by) : '<span class="mut">-</span>');
  const details = [['Age', m.age], ['Gender', m.gender], ['Joined', fmtDate(m.joinDate)], ...(tr ? [] : [['Emergency contact', m.emergency]]), ['Address', m.address], ['Notes', m.notes]];
  view(`<a href="#/members" class="sm">‹ All members</a>
  ${tr && mayEdit ? `<div class="edit-banner">✏️ You added this member. You can edit the details for <b>${mins} more minute${mins === 1 ? '' : 's'}</b>.</div>` : ''}
  <div class="mp-card"><div class="mp-head">${avatar(m, true)}<div class="mp-id"><h2>${esc(m.name)}</h2>
    <div class="mp-sub">${tr ? '' : ic('phone')}<span>${tr ? '' : esc(m.phone) + ' · '}${m.batch} batch</span></div>${addedLine}<div class="mp-badges">${statusBadge(i.status)} ${daysBadge(i.left)}</div></div>
    ${!tr || mayEdit ? `<button class="mp-kebab" data-act="mmenu" data-id="${m.id}" aria-label="More actions">${ic('dots')}</button>` : ''}</div>
    <div class="mp-btns"><button class="mp-btn pri" data-act="renew" data-id="${m.id}">${ic('refresh')}Renew</button>
    ${tr ? '' : `${waBtn(m, i)}<a class="mp-btn" href="tel:${m.phone}">${ic('phone')}Call</a>`}</div>
    ${i.balance ? `<button class="mp-collect" data-act="collect" data-id="${m.id}">${ic('wallet')}Collect pending ${money(i.balance)}</button>` : ''}</div>
  <div class="mp-tiles ${tr ? 'one' : ''}">${tr ? '' : `<div class="mp-tile"><span>Total billed</span><b>${money(i.net)}</b></div><div class="mp-tile"><span>Total paid</span><b>${money(i.paid)}</b></div>`}
    <div class="mp-tile"><span>Pending</span><b style="color:${i.balance ? 'var(--red)' : 'var(--green)'}">${money(i.balance)}</b></div></div>
  <div class="dash"><div><h2>Subscription</h2><div class="card">
    <div class="mp-prog-h"><b>${esc(i.c.planName)}</b><span class="mut sm">${daysText(i.left)}</span></div>
    <div class="mp-bar"><i style="width:${used}%"></i></div>
    <div class="mp-prog-f"><span>Start ${fmtDate(i.c.start)}</span><span>Due ${fmtDate(i.c.due)}</span></div>
    ${mayEdit ? `<button class="btn block" style="margin-top:14px" data-act="editrenew" data-id="${m.id}">${ic('edit')} Edit renewal date / plan</button>` : ''}</div></div>
  <div><h2>Details</h2><div class="card">
    ${details.map(([k, v]) => `<div class="kv"><span class="mut">${k}</span><b style="text-align:right;max-width:60%">${esc(v) || '-'}</b></div>`).join('')}</div></div></div>
    ${canSeeHealth() ? healthCards(m, mayEdit) : ''}
    <h2>Renewal history</h2><div class="tablewrap"><table><thead><tr><th>Renewed on</th><th>Plan</th>${tr ? '' : '<th>Amount</th><th>Discount</th>'}<th>Start</th><th>Due</th><th>Renewed by</th></tr></thead><tbody>
    ${rens.map((r) => `<tr><td>${fmtDate(r.date)}</td><td>${esc(r.planName)}</td>${tr ? '' : `<td>${money(r.price)}</td><td>${money(r.discount)}</td>`}<td>${fmtDate(r.start)}</td><td>${fmtDate(r.due)}</td><td>${r.by ? esc(r.by) : (m.renewals[0] === r && m.addedBy ? esc(m.addedBy) : '<span class="mut">-</span>')}</td></tr>`).join('')}</tbody></table></div>
  <h2>Payment history & invoices</h2>${pays.length ? `<div class="tablewrap"><table><thead><tr><th>Date</th>${tr ? '' : '<th>Amount</th>'}<th>Mode</th><th>Collected by</th><th>Invoice</th><th></th></tr></thead><tbody>
    ${pays.map((p) => `<tr><td>${fmtDate(p.date)}</td>${tr ? '' : `<td>${money(p.amount)}</td>`}<td>${p.mode}</td><td>${who(p)}</td><td>${esc(p.invoiceNo || '-')}</td><td><button class="btn sm" data-act="invoice" data-id="${m.id}" data-p="${p.id}">🧾 Invoice</button></td></tr>`).join('')}</tbody></table></div>` : empty('No payments yet')}
  ${m.logs.length ? `<h2>Edit log</h2><div class="card sm">${[...m.logs].reverse().map((l) => `<div class="kv"><span>${esc(l.text)}${l.by ? ` <span class="mut">· ${esc(l.by)}</span>` : ''}</span><span class="mut">${new Date(l.at).toLocaleString('en-IN')}</span></div>`).join('')}</div>` : ''}`);
}

// ------------------------------------------------------------------ ADD / EDIT member form
function vForm(id) {
  const m = S.route === 'edit' ? getMember(id) : null;
  if (S.route === 'edit' && !m) { location.hash = '#/members'; return; }
  if (m && !canEdit(m)) { toast('The 10-minute edit time for this member is over. Please ask the owner to change it.', 'err'); location.hash = '#/member/' + m.id; return; }
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
    <div class="hf-box"><h2 style="margin-top:0">Health &amp; fitness profile <span class="mut sm" style="font-weight:500">(optional)</span></h2>
      <div class="grid2"><label>Weight (kg)<input name="weight" type="number" inputmode="decimal" min="20" max="300" step="0.1" placeholder="e.g. 72" value="${v('weight')}"></label>
        <label>Height (cm)<input name="height" type="number" inputmode="decimal" min="80" max="250" step="0.1" placeholder="e.g. 170" value="${v('height')}"></label></div>
      <label>Health issues<textarea name="health" style="min-height:64px" placeholder="e.g. back pain, asthma, diabetes, old injury. Leave empty if none.">${v('health')}</textarea></label>
      <div class="grid2"><label>Fitness goal<select name="goal" id="goalSel"><option value="">Select goal</option>${GOALS.map((g) => `<option ${m?.goal === g ? 'selected' : ''}>${g}</option>`).join('')}</select></label>
        <label id="goalOtherBox" class="${m?.goal === 'Other' ? '' : 'hide'}">Write the goal<input name="goalOther" value="${v('goalOther')}" placeholder="e.g. marathon training"></label></div>
      <div class="preview hide" id="bmiPrev" style="margin:0"></div></div>
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
  bindHealthForm();
}
function bindHealthForm() {
  const f = $('#mform'); if (!f) return;
  const upd = () => {
    $('#goalOtherBox')?.classList.toggle('hide', f.goal.value !== 'Other');
    const b = bmiOf(+f.weight.value, +f.height.value), box = $('#bmiPrev');
    if (box) { box.classList.toggle('hide', !b); if (b) { const i = bmiInfo(b); box.innerHTML = `<div class="kv"><span>BMI (calculated)</span><b>${b.toFixed(1)} · <span class="badge ${i[1]}">${i[0]}</span></b></div>`; } }
  };
  ['weight', 'height'].forEach((n) => f[n].addEventListener('input', upd));
  f.goal.addEventListener('change', upd);
  upd();
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
    const wt = d.weight === '' ? '' : +d.weight, ht = d.height === '' ? '' : +d.height;
    if (wt !== '' && !(wt >= 20 && wt <= 300)) throw { message: 'Weight should be between 20 and 300 kg.' };
    if (ht !== '' && !(ht >= 80 && ht <= 250)) throw { message: 'Height should be between 80 and 250 cm.' };
    const base = { name: d.name.trim(), phone, age: d.age, gender: d.gender, batch: d.batch, emergency: d.emergency, address: d.address, joinDate: d.joinDate, notes: d.notes, photo: S.photo || '',
      height: ht, health: (d.health || '').trim(), goal: d.goal || '', goalOther: d.goal === 'Other' ? (d.goalOther || '').trim() : '' };
    if (editId) {
      const m = structuredClone(getMember(editId)), oldJoin = m.joinDate;
      const prevW = +m.weight || 0;
      Object.assign(m, base);
      if (wt !== '' && wt !== prevW) { m.weights = m.weights || []; m.weights.push({ id: uid(), date: todayStr(), kg: wt, at: Date.now() }); }
      syncWeight(m);
      if (oldJoin !== m.joinDate) {
        const oldDue = curRenewal(m).due;
        rechain(m);
        m.logs.push(logEntry(`Joining date ${fmtDate(oldJoin)} → ${fmtDate(m.joinDate)}; due date ${fmtDate(oldDue)} → ${fmtDate(curRenewal(m).due)}; payment & invoice dates follow the joining date`));
      }
      await saveMember(m);
      toast(oldJoin !== m.joinDate ? 'Updated. New due date: ' + fmtDate(curRenewal(m).due) : 'Member updated'); location.hash = '#/member/' + editId;
    } else {
      const p = planOf(d.plan);
      if (!p) throw { message: 'Please add a plan in Settings first.' };
      const disc = Math.max(0, +d.discount || 0), paid = Math.max(0, +d.paid || 0), net = Math.max(0, p.price - disc);
      if (paid > net) throw { message: 'Amount paid cannot be more than the plan price after discount.' };
      const per = calcPeriod(null, d.joinDate, p.days);
      const m = { id: uid(), ...base, weight: '', weights: wt === '' ? [] : [{ id: uid(), date: d.joinDate, kg: wt, at: Date.now() }], createdAt: Date.now(), addedBy: actorName(), addedByUid: S.user.uid, payments: [], logs: [logEntry('Member added')],
        renewals: [{ id: uid(), date: d.joinDate, planId: p.id, planName: p.name, days: p.days, price: p.price, discount: disc, start: per.start, due: per.due, ...byTag() }] };
      syncWeight(m);
      if (paid > 0) await addPayment(m, paid, d.mode, d.joinDate, net - paid);
      await saveNewMember(m);
      toast('Member added'); location.hash = '#/member/' + m.id;
      if (!isTrainer()) setTimeout(() => offerWelcome(m), 250);
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
// Payments recorded together with a renewal (joining / renewal payment) move with that renewal's date,
// so payment date, invoice date and monthly revenue land in the right month. Later "Dues payment" entries keep their own date.
function shiftPayments(m, renewalId, newDate) {
  let n = 0;
  m.payments.forEach((p) => { if (p.renewalId === renewalId && p.note !== 'Dues payment' && p.date !== newDate) { p.date = newDate; n++; } });
  return n;
}
function rechain(m) {
  let prevDue = null;
  m.renewals.forEach((r, k) => {
    if (k === 0 && r.date !== m.joinDate) { r.date = m.joinDate; shiftPayments(m, r.id, r.date); }
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
  m.payments.push({ id: uid(), date, amount, mode, note, ...byTag(), invoiceNo: await nextInvoiceNo(), renewalId: c.id,
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
    m.renewals.push({ id: uid(), date: d.date, planId: p.id, planName: p.name, days: p.days, price: p.price, discount: disc, start: per.start, due: per.due, ...byTag() });
    m.logs.push(logEntry(`Renewed ${p.name}: ${fmtDate(per.start)} → ${fmtDate(per.due)}`));
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
  const moved = old.date !== r.date ? shiftPayments(m, r.id, r.date) : 0;
  const ch = [];
  if (old.start !== r.start) ch.push(`start ${fmtDate(old.start)} → ${fmtDate(r.start)}`);
  if (old.planName !== r.planName) ch.push(`plan ${old.planName} → ${r.planName}`);
  if (old.due !== r.due) ch.push(`due ${fmtDate(old.due)} → ${fmtDate(r.due)}`);
  if (old.price !== r.price) ch.push(`amount ${money(old.price)} → ${money(r.price)}`);
  if (moved) ch.push(`payment & invoice date → ${fmtDate(r.date)}`);
  if (!ch.length) return closeModal();
  m.logs.push(logEntry('Renewal edited: ' + ch.join('; ')));
  syncSnaps(m);
  busy(f, true);
  try { await saveMember(m); closeModal(); toast('Renewal updated. Due date: ' + fmtDate(r.due)); } catch (e) { showErr(f, errMsg(e)); }
  busy(f, false);
};

// ADD weight (keeps history)
function openAddWeight(id) {
  const m = getMember(id); if (!m) return;
  openModal('Add weight · ' + esc(m.name), `<form data-form="addweight" data-id="${id}"><div class="err hide" data-err></div>
    ${m.weight ? `<div class="preview"><div class="kv"><span>Last recorded</span><b>${kgTxt(+m.weight)}</b></div></div>` : ''}
    <div class="grid2"><label>Weight (kg) *<input type="number" name="kg" inputmode="decimal" min="20" max="300" step="0.1" required autofocus></label>
    <label>Date<input type="date" name="date" value="${todayStr()}" max="${todayStr()}" required></label></div>
    <button class="btn primary block" type="submit">Save weight</button></form>`);
}
formHandlers.addweight = async (f) => {
  const d = Object.fromEntries(new FormData(f)), m = structuredClone(getMember(f.dataset.id)), kg = +d.kg;
  if (!(kg >= 20 && kg <= 300)) return showErr(f, 'Weight should be between 20 and 300 kg.');
  busy(f, true);
  try { m.weights = m.weights || []; m.weights.push({ id: uid(), date: d.date, kg, at: Date.now() }); syncWeight(m); await saveMember(m); closeModal(); toast('Weight saved'); } catch (e) { showErr(f, errMsg(e)); }
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
  try { await addPayment(m, amt, d.mode, d.date, bal - amt, 'Dues payment'); m.logs.push(logEntry(`Collected ${money(amt)} (${d.mode}) - dues payment`)); await saveMember(m); closeModal(); toast('Payment saved'); } catch (e) { showErr(f, errMsg(e)); }
  busy(f, false);
};

// invoice modal
function openInvoice(mid, pid) {
  const m = getMember(mid), p = m.payments.find((x) => x.id === pid);
  const d = invoiceData(S.settings, m, p);
  openModal('Invoice ' + esc(d.no), `<div class="preview"><div class="kv"><span>${esc(d.name)}</span><b>${money(d.paid)}</b></div><div class="kv"><span>${esc(d.plan)}</span><span>${fmtDate(d.start)} → ${fmtDate(d.due)}</span></div><div class="kv"><span>Balance due</span><b>${money(d.balance)}</b></div></div>
    <div class="actions"><button class="btn primary" data-act="invpdf" data-m="${mid}" data-p="${pid}">⬇️ Download PDF</button>
    <button class="btn" data-act="invprint" data-m="${mid}" data-p="${pid}">🖨 Print</button>
    ${isTrainer() ? '' : `<button class="btn green" data-act="invwa" data-m="${mid}" data-p="${pid}">Send on WhatsApp</button>`}</div>`);
}
const invFor = (a) => { const m = getMember(a.m), p = m.payments.find((x) => x.id === a.p), d = invoiceData(S.settings, m, p); if (isTrainer()) d.phone = ''; return d; };

// ------------------------------------------------------------------ REMINDERS
function reminderRow(x, expired) {
  const { m, i } = x, tmr = i.left === 1;
  const wa = waBtn(m, i);
  const call = `<a class="mp-btn" href="tel:${m.phone}">${ic('phone')}Call</a>`;
  const renew = `<button class="mp-btn pri" data-act="renew" data-id="${m.id}">${ic('refresh')}Renew</button>`;
  return `<div class="rem ${tmr ? 'tmr' : ''}"><div class="rem-top" data-act="open" data-id="${m.id}">${avatar(m)}<div class="info"><div class="nm">${esc(m.name)}</div>
    <div class="sm mut">${esc(m.phone)} · ${esc(i.c.planName)} · ${m.batch}</div><div class="sm mut">${expired ? 'Expired' : 'Due'} ${fmtDate(i.c.due)}</div>
    <div class="row2">${daysBadge(i.left)}${tmr ? '<span class="badge pulse">Remind today</span>' : ''}${i.balance ? `<span class="badge red">Due ${money(i.balance)}</span>` : ''}</div></div></div>
    <div class="mp-btns">${expired ? renew + wa + call : wa + call + renew}</div></div>`;
}
function welcomeRow(x) {
  const { m, i } = x;
  return `<div class="rem"><div class="rem-top" data-act="open" data-id="${m.id}">${avatar(m)}<div class="info"><div class="nm">${esc(m.name)}</div>
    <div class="sm mut">${esc(m.phone)} · ${esc(i.c.planName)} · ${m.batch}</div><div class="sm mut">Joined ${fmtDate(m.joinDate)} · Due ${fmtDate(i.c.due)}</div>
    <div class="row2"><span class="badge blue">Welcome pending</span>${i.balance ? `<span class="badge red">Due ${money(i.balance)}</span>` : ''}</div></div></div>
    <div class="mp-btns">${waBtn(m, i)}<a class="mp-btn" href="tel:${m.phone}">${ic('phone')}Call</a><button class="mp-btn" data-act="welcomeskip" data-id="${m.id}">Skip</button></div></div>`;
}
function vReminders() {
  setTitle('Renewal Reminders');
  const list = L(), soon = list.filter((x) => x.i.left >= 0 && x.i.left <= SOON_DAYS).sort((a, b) => a.i.left - b.i.left);
  const exp = list.filter((x) => x.i.left < 0).sort((a, b) => b.i.left - a.i.left);
  const wel = list.filter((x) => isWelcome(x.m)).sort((a, b) => (b.m.createdAt || 0) - (a.m.createdAt || 0));
  const tab = ['expired', 'welcome'].includes(S.rTab) ? S.rTab : 'soon', tmr = soon.filter((x) => x.i.left === 1).length;
  const tb = (t, label, n) => `<button class="${tab === t ? 'on' : ''}" data-act="rtab" data-t="${t}">${label} <span class="cnt">${n}</span></button>`;
  const body = tab === 'welcome'
    ? wel.map(welcomeRow).join('') || empty('No new members waiting for a welcome message')
    : tab === 'expired'
      ? exp.map((x) => reminderRow(x, true)).join('') || empty('No expired members 🎉')
      : `${tmr ? `<div class="rem-bar"><span>${ic('whatsapp')} ${tmr} expiring tomorrow</span><button data-act="walltomorrow">Send all</button></div>` : ''}${soon.map((x) => reminderRow(x, false)).join('') || empty('🎉 Nobody expiring soon')}`;
  view(`<div class="seg three">${tb('soon', 'Expiring soon', soon.length)}${tb('expired', 'Expired', exp.length)}${tb('welcome', 'Welcome', wel.length)}</div>${body}`);
}
let walList = [], walIdx = 0;
function walStep() {
  const x = walList[walIdx];
  if (!x) { closeModal(); return toast('All reminders done ✅'); }
  openModal(`Reminder ${walIdx + 1} of ${walList.length}`, `<div class="head" style="margin-bottom:12px">${avatar(x.m, true)}<div class="grow"><h3>${esc(x.m.name)}</h3><div class="mut">${esc(x.i.c.planName)} · expires ${fmtDate(x.i.c.due)}</div></div></div>
    <div class="preview">${esc(msgFor(x.m, x.i))}</div>
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

// ------------------------------------------------------------------ DUE GROUPS (dashboard cards + detail list)
// Renewal dues   = membership ends within the next 5 days, or expired 2 days ago or less. Amount = member's current plan price.
// Unpaid balance = money still owed on a plan already joined/renewed. Amount = pending balance.
const RENEW_AHEAD = 5, RENEW_GRACE = 2;
function dueGroups() {
  const list = L();
  const renewal = list.filter((x) => x.i.left <= RENEW_AHEAD && x.i.left >= -RENEW_GRACE).sort((a, b) => a.i.left - b.i.left);
  const unpaid = list.filter((x) => x.i.balance > 0).sort((a, b) => b.i.balance - a.i.balance);
  return { renewal, unpaid, rTotal: renewal.reduce((a, x) => a + (+x.i.c.price || 0), 0), uTotal: unpaid.reduce((a, x) => a + x.i.balance, 0) };
}
function dueRow(x, kind) {
  const { m, i } = x, unpaid = kind === 'unpaid';
  const amt = unpaid ? i.balance : +i.c.price || 0;
  const wa = unpaid
    ? waLink(m.phone, `Hello ${m.name}, a balance of ${money(i.balance)} is pending for your ${i.c.planName} membership at ${S.settings.gymName}. Please clear it at your earliest. Thank you!`)
    : waFor(m, i);
  return `<div class="rrow">${avatar(m)}<div class="info" data-act="open" data-id="${m.id}" style="cursor:pointer"><div><b>${esc(m.name)}</b></div>
    <div class="sm mut">${esc(i.c.planName)} · ${m.batch} · due ${fmtDate(i.c.due)}</div>
    <div style="margin-top:4px">${daysBadge(i.left)}${!unpaid && i.balance ? ` <span class="badge red">Unpaid ${money(i.balance)}</span>` : ''}${unpaid ? ` <span class="badge blue">Plan ${money(i.c.price)}</span>` : ''}</div></div>
    <div style="text-align:right"><div class="sm mut">${unpaid ? 'Unpaid balance' : 'Plan price'}</div><b style="font-size:18px;color:${unpaid ? 'var(--red)' : 'inherit'}">${money(amt)}</b></div>
    <div class="acts"><button class="btn primary" data-act="renew" data-id="${m.id}">Renew</button>${isTrainer() ? '' : `<a class="btn green" href="${wa}" target="_blank" rel="noopener">WhatsApp</a><a class="btn" href="tel:${m.phone}">📞 Call</a>`}${i.balance ? `<button class="btn" data-act="collect" data-id="${m.id}">💰 Collect ${money(i.balance)}</button>` : ''}</div></div>`;
}
function vDueList(kind) {
  kind = kind === 'unpaid' ? 'unpaid' : 'renewal';
  const g = dueGroups(), rows = g[kind], total = kind === 'unpaid' ? g.uTotal : g.rTotal;
  setTitle(kind === 'unpaid' ? 'Unpaid Balance' : 'Renewal Dues');
  view(`<div class="seg"><button class="${kind === 'renewal' ? 'on' : ''}" data-act="go" data-to="#/duelist/renewal">Renewal dues (${g.renewal.length})</button><button class="${kind === 'unpaid' ? 'on' : ''}" data-act="go" data-to="#/duelist/unpaid">Unpaid balance (${g.unpaid.length})</button></div>
    <div class="stats" style="margin-bottom:12px"><div class="stat"><div><div class="l">Total</div><b style="color:var(--red)">${money(total)}</b></div></div><div class="stat"><div><div class="l">Members</div><b>${rows.length}</b></div></div></div>
    <div class="note">${kind === 'unpaid'
      ? 'Members who still owe money on a plan they have already joined or renewed. Amount = pending balance.'
      : `Members whose membership ends in the next ${RENEW_AHEAD} days, plus members expired ${RENEW_GRACE} days ago or less. Amount = the member's current plan price. Members expired for more than ${RENEW_GRACE} days are not counted.`}</div>
    ${rows.map((x) => dueRow(x, kind)).join('') || empty(kind === 'unpaid' ? '🎉 No unpaid balances' : '🎉 No renewals due right now')}`);
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
  if (kind === 'members') download(`members-${stamp()}.csv`, csv([['Name', 'Phone', 'Age', 'Gender', 'Address', 'Emergency', 'Joined', 'Batch', 'Plan', 'Start', 'Due', 'Days left', 'Status', 'Billed', 'Paid', 'Pending', 'Notes', 'Weight (kg)', 'Height (cm)', 'BMI', 'Health issues', 'Fitness goal'],
    ...L().map(({ m, i }) => [m.name, m.phone, m.age, m.gender, m.address, m.emergency, m.joinDate, m.batch, i.c.planName, i.c.start, i.c.due, i.left, i.status, i.net, i.paid, i.balance, m.notes, m.weight, m.height, bmiOf(+m.weight, +m.height) ? bmiOf(+m.weight, +m.height).toFixed(1) : '', m.health, goalOf(m)])]));
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
  await saveSettings({ gymName: s.gymName ?? S.settings.gymName, plans: s.plans ?? S.settings.plans, template: s.template ?? S.settings.template, expiredTemplate: s.expiredTemplate ?? S.settings.expiredTemplate ?? DEFAULT_EXPIRED_TEMPLATE, welcomeTemplate: s.welcomeTemplate ?? S.settings.welcomeTemplate ?? DEFAULT_WELCOME_TEMPLATE, logo: s.logo ?? '', terms: s.terms ?? S.settings.terms ?? '', rules: s.rules ?? S.settings.rules ?? '', invSeq: Math.max(s.invSeq || 0, S.settings.invSeq || 0) });
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
    <h2>Invoice terms & gym rules</h2><form class="card" data-form="terms"><div class="note">These print on an extra page after every invoice (PDF, print and WhatsApp). Write one point per line. Leave a box empty to leave it out.</div>
      <label>Terms & Conditions<textarea name="terms" style="min-height:170px">${esc(s.terms || '')}</textarea></label>
      <label>Gym Rules<textarea name="rules" style="min-height:170px">${esc(s.rules || '')}</textarea></label>
      <div class="actions"><button class="btn primary" type="submit">Save terms & rules</button><button type="button" class="btn" data-act="previewterms">Preview invoice</button></div></form>
    <h2>WhatsApp messages</h2><form class="card" data-form="template"><label>Welcome message (new members)<textarea name="welcomeTemplate">${esc(s.welcomeTemplate || DEFAULT_WELCOME_TEMPLATE)}</textarea></label>
      <label>Expiring soon message<textarea name="template">${esc(s.template)}</textarea></label>
      <label>Already expired message<textarea name="expiredTemplate">${esc(s.expiredTemplate || DEFAULT_EXPIRED_TEMPLATE)}</textarea></label>
      <div class="sm mut" style="margin-bottom:10px">Use: {name} {plan} {start} {date} {gym}. {start} is the start date and {date} is the due date. Members with more than 5 days left get no message.</div><div class="actions"><button class="btn primary" type="submit">Save message</button><button type="button" class="btn" data-act="resettpl">Reset</button></div></form>
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
// ------------------------------------------------------------------ TRAINERS (owner only)
const sref2 = (key) => doc(db, 'gyms', uidOf(), 'staff', key);
function vStaff() {
  setTitle('Trainers');
  const list = [...S.staffList].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const when = (t) => new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const status = (t) => (t.active === false ? '<span class="badge red">Switched off</span>' : t.lastSeenAt ? '<span class="badge green">Active</span>' : '<span class="badge orange">Invited · not signed up yet</span>');
  const acts = S.members.flatMap((m) => m.logs.filter((l) => l.byId && l.by && l.by !== 'Owner').map((l) => ({ m, l }))).sort((a, b) => b.l.at - a.l.at).slice(0, 30);
  view(`<div class="dash"><div>
    <h2 style="margin-top:0">Invite a trainer</h2>
    <form class="card" data-form="invite" autocomplete="off"><div class="err hide" data-err></div>
      <div class="note"><b>What a trainer can do:</b> add members (and edit them for 10 minutes), renew memberships, collect payments and see pending dues.<br>
      <b>What a trainer cannot do:</b> see revenue, reports or phone numbers, send WhatsApp messages, change settings or plans, delete or edit old members.</div>
      <div class="grid2"><label>Trainer name *<input name="name" required placeholder="e.g. Ravi"></label><label>Trainer email *<input name="email" type="email" required placeholder="trainer@gmail.com"></label></div>
      <label class="chk"><input type="checkbox" name="health"> Allow this trainer to see members' health details</label>
      <button class="btn primary" type="submit">${ic('userplus')} Invite trainer</button>
      <div class="sm mut" style="margin-top:12px">After inviting, ask the trainer to open <b>${esc(location.origin)}</b>, tap <b>“Create your trainer login”</b> and use the same email. They make their own password and verify their email.</div></form>
    <h2>Your trainers (${list.length})</h2>
    ${list.map((t) => `<div class="card staff-card"><div class="staff-top"><div class="av">${esc(initials(t.name))}</div><div class="grow"><b>${esc(t.name)}</b><div class="sm mut">${esc(t.email || t.key)}</div></div>${status(t)}</div>
      <div class="sm mut" style="margin:8px 0">${t.lastSeenAt ? 'Last active ' + when(t.lastSeenAt) : 'Has not logged in yet'} · Health details: <b>${t.canSeeHealth ? 'allowed' : 'hidden'}</b></div>
      <div class="actions"><button class="btn sm" data-act="staffhealth" data-k="${esc(t.key)}">${t.canSeeHealth ? 'Hide health details' : 'Allow health details'}</button>
      <button class="btn sm" data-act="staffactive" data-k="${esc(t.key)}">${t.active === false ? 'Switch on' : 'Switch off'}</button>
      <button class="btn sm danger" data-act="staffremove" data-k="${esc(t.key)}">Remove</button></div></div>`).join('') || empty('No trainers yet. Invite your first trainer above.')}
  </div><div>
    <h2 style="margin-top:0">Recent trainer activity</h2>
    <div class="card sm">${acts.map(({ m, l }) => `<div class="kv"><span><b>${esc(l.by)}</b> · ${esc(l.text)} <span class="mut">(${esc(m.name)})</span></span><span class="mut">${when(l.at)}</span></div>`).join('') || '<span class="mut">Nothing yet. What your trainers add, renew or collect will be listed here.</span>'}</div>
  </div></div>`);
}
formHandlers.invite = async (f) => {
  const d = Object.fromEntries(new FormData(f)), name = d.name.trim(), email = d.email.trim().toLowerCase();
  if (!name) return showErr(f, 'Please enter the trainer name.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return showErr(f, 'Please enter a valid email address.');
  if (email === (S.user.email || '').toLowerCase()) return showErr(f, 'That is your own owner email. Use the trainer\'s own email.');
  if (S.staffList.some((t) => t.key === email)) return showErr(f, 'This email is already added.');
  busy(f, true); showErr(f, '');
  try {
    await setDoc(sref2(email), { name, email, active: true, canSeeHealth: !!d.health, createdAt: Date.now() });
    await setDoc(doc(db, 'staffIndex', email), { ownerId: uidOf(), name });
    f.reset(); toast('Trainer invited. They can now create their login.');
  } catch (e) { showErr(f, errMsg(e)); }
  busy(f, false);
};
const staffActions = {
  async staffhealth(a) { const t = S.staffList.find((x) => x.key === a.k); if (!t) return; try { await setDoc(sref2(a.k), { canSeeHealth: !t.canSeeHealth }, { merge: true }); toast(t.canSeeHealth ? 'Health details hidden from ' + t.name : 'Health details allowed for ' + t.name); } catch (e) { toast(errMsg(e), 'err'); } },
  async staffactive(a) { const t = S.staffList.find((x) => x.key === a.k); if (!t) return; const on = t.active === false; try { await setDoc(sref2(a.k), { active: on }, { merge: true }); toast(on ? t.name + ' can log in again' : t.name + ' is switched off'); } catch (e) { toast(errMsg(e), 'err'); } },
  async staffremove(a) {
    const t = S.staffList.find((x) => x.key === a.k); if (!t) return;
    if (!confirm(`Remove ${t.name} (${t.email || a.k})? They will lose access straight away. Their past work stays on the members.`)) return;
    try { await deleteDoc(sref2(a.k)); await deleteDoc(doc(db, 'staffIndex', a.k)); toast('Trainer removed'); } catch (e) { toast(errMsg(e), 'err'); }
  },
};

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
  async terms(f) { const fd = new FormData(f); await saveSettings({ terms: String(fd.get('terms') || '').trim(), rules: String(fd.get('rules') || '').trim() }); toast('Terms & rules saved'); },
  async template(f) { const fd = new FormData(f); await saveSettings({ template: fd.get('template'), expiredTemplate: fd.get('expiredTemplate'), welcomeTemplate: fd.get('welcomeTemplate') }); toast('Messages saved'); },
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
  go(a) { if (a.to === '#/members') resetFilters(); location.hash = a.to; },
  filt(a) { resetFilters(); S.mTab = a.st === 'expired' ? 'expired' : 'active'; S.fPlan = a.plan || ''; S.fJoin = !!a.join; },
  rtab(a) { S.rTab = ['expired', 'welcome'].includes(a.t) ? a.t : 'soon'; vReminders(); },
  welcomesent(a) { setTimeout(closeModal, 300); return markWelcome(a.id, 'Welcome message sent on WhatsApp'); },
  async welcomeskip(a) { await markWelcome(a.id, 'Welcome message skipped'); toast('Skipped'); },
  mtab(a) { S.mTab = a.t === 'expired' ? 'expired' : 'active'; drawMembers(); },
  clearfilters() { const t = S.mTab; resetFilters(); S.mTab = t; vMembers(); },
  back() {
    const cur = location.hash || '#/dashboard';
    if (navStack[navStack.length - 1] === cur) navStack.pop();
    const prev = navStack[navStack.length - 1];
    location.hash = prev && prev !== cur ? prev : '#/dashboard';
  },
  auth: (a) => authScreen(a.to),
  eye(a, el) { const i = el.parentElement.querySelector('input'); i.type = i.type === 'password' ? 'text' : 'password'; },
  logout() {
    // switch to the login screen immediately; Firebase finishes signing out in the background
    if (S.loggingOut) return; S.loggingOut = true;
    sessionStorage.removeItem('gm_unlocked');
    closeModal(); unsubs.forEach((u) => u()); unsubs = [];
    S.user = null; S.role = 'owner'; S.ownerId = ''; S.staff = null; S.shell = false; S.members = []; S.ready = { s: false, m: false }; S.settings = { ...DEF_SETTINGS };
    $('#lock').innerHTML = ''; authScreen('login');
    signOut(auth).catch(() => {}).finally(() => { S.loggingOut = false; });
  },
  async verified(a, el) {
    el.disabled = true;
    try { await S.user.reload(); await S.user.getIdToken(true); if (S.user.emailVerified) enter(S.user); else toast('Not verified yet. Open the link in your email first.', 'err'); }
    catch (e) { toast(errMsg(e), 'err'); }
    el.disabled = false;
  },
  resendverify() { sendEmailVerification(S.user).then(() => toast('Verification email sent')).catch((e) => toast(errMsg(e), 'err')); },
  closemodal: closeModal,
  addweight: (a) => openAddWeight(a.id),
  async delweight(a) {
    if (!confirm('Delete this weight entry?')) return;
    const m = structuredClone(getMember(a.id)); if (!m) return;
    m.weights = (m.weights || []).filter((w) => w.id !== a.w); syncWeight(m);
    try { await saveMember(m); toast('Entry deleted'); } catch (e) { toast(errMsg(e), 'err'); }
  },
  mmenu(a) {
    const m = getMember(a.id); if (!m) return; const i = memberInfo(m), other = m.batch === 'Morning' ? 'Evening' : 'Morning';
    openModal('Manage member', `<div class="mm-list">
      ${canEdit(m) ? `<button class="mm-row" data-act="mact" data-do="go" data-to="#/edit/${m.id}">${ic('edit')}<span>Edit details</span></button>` : ''}
      ${isTrainer() ? '' : `<button class="mm-row" data-act="mact" data-do="movebatch" data-id="${m.id}">${ic('swap')}<span>Move to ${other} batch</span></button>`}
      ${i.balance ? `<button class="mm-row" data-act="mact" data-do="collect" data-id="${m.id}">${ic('wallet')}<span>Collect ${money(i.balance)}</span></button>` : ''}
      ${isTrainer() ? '' : `<button class="mm-row danger" data-act="mact" data-do="delmember" data-id="${m.id}">${ic('trash')}<span>Delete member<small>Also removes payment history</small></span></button>`}</div>`);
  },
  mact(a) { closeModal(); actions[a.do]?.(a); },
  ovclick(a, el, e) { if (e.target === el) closeModal(); },
  more() {
    const tiles = isTrainer() ? [] : [['batches', 'clock', 'Batches', 'Morning and evening'], ['dues', 'wallet', 'Payments and dues', 'Collect and track'], ['reports', 'chart', 'Reports', 'Revenue and joinings'], ['staff', 'userplus', 'Trainers', 'Invite and manage'], ['settings', 'gear', 'Settings', 'Plans, backup, account']];
    openModal(isTrainer() ? esc(actorName()) + ' · Trainer' : 'More', `${tiles.length ? '' : '<p class="mut" style="margin:0 0 12px">You are logged in as a trainer.</p>'}<div class="more-grid">${tiles.map(([r, i, l, d]) => `<button class="more-tile" data-act="go" data-to="#/${r}"><span class="more-ic">${ic(i)}</span><b>${l}</b><small>${d}</small></button>`).join('')}</div>
      <button class="more-out" data-act="logout">${ic('logout')} Log out</button>`);
  },
  sort(a) { S.sort = { k: a.k, d: S.sort.k === a.k ? -S.sort.d : 1 }; drawMembers(); },
  open: (a) => (location.hash = '#/member/' + a.id),
  renew: (a) => openRenew(a.id),
  editrenew: (a) => openEditRenew(a.id),
  collect: (a) => openCollect(a.id),
  invoice: (a) => openInvoice(a.id, a.p),
  async invpdf(a, el) { el.disabled = true; try { const d = invFor(a); download(`Invoice-${d.no}.pdf`, await invoiceBlob(d)); } catch (e) { toast(e.message, 'err'); } el.disabled = false; },
  async invprint(a) { try { await printInvoice(invFor(a)); } catch (e) { toast(e.message, 'err'); } },
  async previewterms() {
    const fd = new FormData($('[data-form=terms]')), t = todayStr();
    const d = { gym: S.settings.gymName, gymPhone: S.settings.phone, logo: S.settings.logo, terms: fd.get('terms'), rules: fd.get('rules'), no: 'INV-0001', date: t, name: 'Sample Member', phone: '9876543210', plan: '1 Month', start: t, due: addDays(t, 30), price: 1000, discount: 0, paid: 1000, balance: 0, mode: 'UPI' };
    try { const pages = await renderInvoicePages(d); openModal('Invoice preview', `<div class="inv-prev">${pages.map((c) => `<img src="${c.toDataURL('image/jpeg', 0.85)}" alt="">`).join('')}</div>`, true); } catch (e) { toast(e.message, 'err'); }
  },
  async invwa(a, el) { el.disabled = true; try { await shareInvoiceWhatsApp(invFor(a), waLink, download); } catch (e) { toast(e.message, 'err'); } el.disabled = false; },
  async movebatch(a) { const m = structuredClone(getMember(a.id)), to = m.batch === 'Morning' ? 'Evening' : 'Morning'; m.logs.push(logEntry(`Batch ${m.batch} → ${to}`)); m.batch = to; await saveMember(m); toast(`Moved to ${to} batch`); },
  async delmember(a) { const m = getMember(a.id); if (confirm(`Delete ${m.name} permanently, including payment history? This cannot be undone.`)) { await deleteDoc(mref(a.id)); toast('Member deleted'); location.hash = '#/members'; } },
  tabbatch(a) { S.batchTab = a.b; if (S.route === 'batches') vBatches(); },
  takephoto() { isTouch ? $('#camIn').click() : openWebcam(); },
  choosephoto: () => $('#fileIn').click(),
  rmphoto: () => setPhoto(''),
  snap,
  addplanrow() { $('#planrows').insertAdjacentHTML('beforeend', planRow({ id: uid(), name: '', days: 30, price: 0 })); $('#planrows .planrow:last-child input')?.focus(); },
  rmplanrow(a, el) { el.closest('.planrow').remove(); },
  resettpl() { $('[name=template]').value = DEFAULT_TEMPLATE; $('[name=expiredTemplate]').value = DEFAULT_EXPIRED_TEMPLATE; $('[name=welcomeTemplate]').value = DEFAULT_WELCOME_TEMPLATE; },
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
Object.assign(actions, staffActions);
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
  else if (t.id === 'rmonth' && t.value) { S.rmonth = t.value; vReports(); }
  else if (t.closest('#mform')) updateAddPreview(t.name === 'plan' || t.name === 'discount' || t.name === 'joinDate' ? t.name !== 'joinDate' : false);
});
