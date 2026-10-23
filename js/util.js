// Small helpers + the subscription due-date rules (pure functions, no Firebase here)

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const money = (n) => '₹' + (Math.round((+n || 0) * 100) / 100).toLocaleString('en-IN');
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

// ---------- dates (all dates are plain 'YYYY-MM-DD' strings, no timezone surprises) ----------
const pad = (n) => String(n).padStart(2, '0');
export const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const toUTC = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
export const addDays = (s, n) => {
  const t = new Date(toUTC(s) + n * 864e5);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
};
export const diffDays = (a, b) => Math.round((toUTC(a) - toUTC(b)) / 864e5);
export const fmtDate = (s) =>
  s ? new Date(toUTC(s)).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '';

// ---------- subscription rules (section 7) ----------
// Due date = start + plan days.
// Renewing: if old subscription still active (oldDue >= renewalDate) new period starts at old due date,
// otherwise it starts on the renewal date.
export function calcPeriod(prevDue, renewalDate, days) {
  const start = prevDue && prevDue >= renewalDate ? prevDue : renewalDate;
  return { start, due: addDays(start, days) };
}

export const curRenewal = (m) => m.renewals[m.renewals.length - 1];

export const SOON_DAYS = 5; // "Expiring soon" = 0..5 days left
export function memberInfo(m, today = todayStr()) {
  const c = curRenewal(m);
  const left = diffDays(c.due, today);
  const status = left < 0 ? 'expired' : left <= SOON_DAYS ? 'soon' : 'active';
  const net = m.renewals.reduce((a, r) => a + (+r.price || 0) - (+r.discount || 0), 0);
  const paid = m.payments.reduce((a, p) => a + (+p.amount || 0), 0);
  return { c, left, status, net, paid, balance: Math.max(0, net - paid) };
}

export const daysText = (left) =>
  left < 0 ? `Expired ${-left} day${-left > 1 ? 's' : ''} ago` : left === 0 ? 'Expires today' : `${left} day${left > 1 ? 's' : ''} left`;
export const daysBadge = (left) =>
  `<span class="badge ${left < 0 ? 'red' : left <= SOON_DAYS ? 'orange' : 'green'}">${daysText(left)}</span>`;
export const statusBadge = (st) =>
  st === 'expired'
    ? '<span class="badge red">Expired</span>'
    : st === 'soon'
    ? '<span class="badge orange">Expiring Soon</span>'
    : '<span class="badge green">Active</span>';

// ---------- phone / whatsapp ----------
export function normPhone(v) {
  let d = String(v || '').replace(/\D/g, '');
  if (d.length > 10 && d.startsWith('91')) d = d.slice(2);
  if (d.length > 10 && d.startsWith('0')) d = d.slice(1);
  return d;
}
export const validPhone = (d) => /^[6-9]\d{9}$/.test(d);
export const waLink = (phone, msg) => `https://wa.me/91${phone}${msg ? `?text=${encodeURIComponent(msg)}` : ''}`; // empty message = just open the chat
export const fmtMsg = (tpl, v) =>
  String(tpl)
    .replace(/\{name\}/gi, v.name)
    .replace(/\{plan\}/gi, v.plan)
    .replace(/\{date\}/gi, v.date)
    .replace(/\{start\}/gi, v.start ?? '')
    .replace(/\{(gym|gym name)\}/gi, v.gym);

// ---------- files ----------
export function csv(rows) {
  return (
    '﻿' +
    rows
      .map((r) =>
        r
          .map((v) => {
            v = v == null ? '' : String(v);
            return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
          })
          .join(',')
      )
      .join('\r\n')
  );
}
export function download(name, content, type = 'text/csv;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1500);
}
// Resize + JPEG-compress an image (File/Blob) to a small data URL before saving.
export async function compressImage(src, max = 320, q = 0.72) {
  let bmp;
  try {
    bmp = await createImageBitmap(src);
  } catch {
    bmp = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = URL.createObjectURL(src);
    });
  }
  const w = bmp.width || bmp.naturalWidth,
    h = bmp.height || bmp.naturalHeight;
  const s = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * s);
  c.height = Math.round(h * s);
  const x = c.getContext('2d');
  x.fillStyle = '#fff';
  x.fillRect(0, 0, c.width, c.height);
  x.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', q);
}
