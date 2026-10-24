// Invoice: branded A4 invoice + optional "Terms & Conditions / Gym Rules" pages.
// Pages are drawn on a canvas (so ANY language works: English, Kannada, Hindi...) and then
// placed into a PDF (download / WhatsApp) or printed. jsPDF is only used as the PDF container.
import { money, fmtDate } from './util.js';

export function invoiceData(settings, m, p) {
  const s = p.snap || {};
  return {
    gym: settings.gymName,
    gymPhone: settings.phone,
    logo: settings.logo,
    terms: settings.terms || '',
    rules: settings.rules || '',
    no: p.invoiceNo || '-',
    date: p.date,
    name: m.name,
    phone: m.phone,
    plan: s.planName,
    start: s.start,
    due: s.due,
    price: s.price,
    discount: s.discount || 0,
    paid: p.amount,
    balance: s.balance || 0,
    mode: p.mode,
  };
}

// ---------------------------------------------------------------- canvas drawing
const W = 1240, H = 1754; // A4 at 150 dpi
const NAVY = '#00102e', NAVY2 = '#04245a', BLUE = '#0877d1', GOLD = '#fab706', INK = '#0b1b33', MUT = '#62748e', LINE = '#dce6f1';
const FONT = '"Inter","Segoe UI",Roboto,"Noto Sans","Noto Sans Kannada","Noto Sans Devanagari","Nirmala UI","Helvetica Neue",Arial,sans-serif';
const font = (w, px) => `${w} ${px}px ${FONT}`;
const MARGIN = 70;

function newPage() {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
  x.textBaseline = 'alphabetic';
  return { c, x };
}
function loadImg(src) {
  return new Promise((res) => {
    if (!src) return res(null);
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => res(null);
    i.src = src;
  });
}
function band(x, h) {
  const g = x.createLinearGradient(0, 0, W, h);
  g.addColorStop(0, NAVY); g.addColorStop(0.7, NAVY2); g.addColorStop(1, '#0a4a99');
  x.fillStyle = g; x.fillRect(0, 0, W, h);
  x.fillStyle = GOLD; x.fillRect(0, h, W, 8);
}
function strip(x) {
  x.fillStyle = GOLD; x.fillRect(0, H - 34, W, 6);
  x.fillStyle = NAVY; x.fillRect(0, H - 28, W, 28);
}
function contain(img, maxW, maxH) {
  const s = Math.min(maxW / img.width, maxH / img.height);
  return { w: img.width * s, h: img.height * s };
}
// brand logo on the navy band: custom uploaded logo goes on a white tile, default logo is blended in
function drawBrand(x, brand, custom, left, top, maxW, maxH) {
  if (custom) {
    const t = Math.min(maxH, 170);
    x.fillStyle = '#fff';
    x.beginPath();
    x.roundRect ? x.roundRect(left, top, t, t, 22) : x.rect(left, top, t, t);
    x.fill();
    const d = contain(custom, t - 24, t - 24);
    x.drawImage(custom, left + (t - d.w) / 2, top + (t - d.h) / 2, d.w, d.h);
    return t;
  }
  if (brand) {
    const d = contain(brand, maxW, maxH);
    x.drawImage(brand, left, top, d.w, d.h);
    return d.w;
  }
  return 0;
}
function wrap(x, text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      if (!word) continue;
      if (x.measureText(line + word).width <= maxW) { line += word; continue; }
      if (line.trim()) out.push(line.trimEnd());
      line = '';
      if (x.measureText(word).width <= maxW) { line = word.trimStart(); continue; }
      // very long word or text without spaces: break by characters
      for (const ch of word) {
        if (x.measureText(line + ch).width > maxW) { out.push(line); line = ''; }
        line += ch;
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}

function invoicePage(d, brand, custom) {
  const { c, x } = newPage();
  band(x, 300);
  const bw = drawBrand(x, brand, custom, MARGIN, 52, 560, 196);
  if (custom) {
    x.fillStyle = '#fff'; x.font = font(800, 40); x.textAlign = 'left';
    x.fillText(d.gym || '', MARGIN + bw + 28, 140);
  }
  x.textAlign = 'right';
  x.fillStyle = GOLD; x.font = font(800, 70); x.fillText('INVOICE', W - MARGIN, 125);
  x.fillStyle = '#d6e8fa'; x.font = font(600, 30);
  x.fillText('No: ' + d.no, W - MARGIN, 182);
  x.fillText('Date: ' + fmtDate(d.date), W - MARGIN, 226);

  x.textAlign = 'left';
  x.fillStyle = NAVY; x.font = font(800, 42); x.fillText(d.gym || '', MARGIN, 395);
  if (d.gymPhone) { x.fillStyle = MUT; x.font = font(400, 28); x.fillText('Ph: ' + d.gymPhone, MARGIN, 440); }

  // billed to / validity
  x.fillStyle = BLUE; x.font = font(700, 22);
  x.fillText('BILLED TO', MARGIN, 535);
  x.textAlign = 'right'; x.fillText('MEMBERSHIP VALIDITY', W - MARGIN, 535);
  x.textAlign = 'left'; x.fillStyle = INK; x.font = font(700, 38); x.fillText(d.name || '', MARGIN, 586);
  x.fillStyle = MUT; x.font = font(400, 30); x.fillText(String(d.phone || ''), MARGIN, 632);
  x.textAlign = 'right'; x.fillStyle = INK; x.font = font(700, 34);
  x.fillText(`${fmtDate(d.start)} to ${fmtDate(d.due)}`, W - MARGIN, 586);
  x.fillStyle = MUT; x.font = font(400, 30); x.fillText(String(d.plan || ''), W - MARGIN, 632);

  // table
  const tx = MARGIN, tw = W - MARGIN * 2;
  let y = 720;
  x.fillStyle = '#e8f3fd'; x.fillRect(tx, y, tw, 72);
  x.fillStyle = '#055aa3'; x.font = font(700, 24);
  x.textAlign = 'left'; x.fillText('DESCRIPTION', tx + 26, y + 46);
  x.textAlign = 'right'; x.fillText('AMOUNT', tx + tw - 26, y + 46);
  const rows = [
    [`${d.plan || ''} gym membership`, money(d.price), false, INK],
    ['Discount', '- ' + money(d.discount), false, INK],
    [`Amount paid (${d.mode || ''})`, money(d.paid), true, INK],
    ['Balance due', money(d.balance), true, d.balance > 0 ? '#dc2626' : '#16a34a'],
  ];
  y += 72;
  rows.forEach(([a, b, bold, col], i) => {
    const rh = 88;
    if (i === 2) { x.fillStyle = '#fff8dc'; x.fillRect(tx, y, tw, rh); }
    x.fillStyle = col; x.font = font(bold ? 700 : 400, 32);
    x.textAlign = 'left'; x.fillText(a, tx + 26, y + 57);
    x.textAlign = 'right'; x.fillText(b, tx + tw - 26, y + 57);
    x.fillStyle = LINE; x.fillRect(tx, y + rh - 2, tw, 2);
    y += rh;
  });

  x.textAlign = 'center';
  x.fillStyle = NAVY; x.font = font(700, 34); x.fillText(`Thank you for training with ${d.gym || 'us'}!`, W / 2, y + 120);
  if ((d.terms || '').trim() || (d.rules || '').trim()) {
    x.fillStyle = MUT; x.font = font(400, 27);
    x.fillText('Please read the Terms & Conditions and Rules on the next page.', W / 2, y + 175);
  }
  strip(x);
  return c;
}

// Terms / rules pages (may run over several pages)
function termsPages(d, brand, custom) {
  const pages = [];
  let cur = null, y = 0;
  const startPage = () => {
    cur = newPage();
    const { x } = cur;
    band(x, 170);
    drawBrand(x, brand, custom, MARGIN, 24, 330, 120);
    x.textAlign = 'right';
    x.fillStyle = GOLD; x.font = font(800, 50); x.fillText('Terms & Rules', W - MARGIN, 90);
    x.fillStyle = '#d6e8fa'; x.font = font(600, 26); x.fillText(`Invoice ${d.no}  ·  ${d.gym || ''}`, W - MARGIN, 134);
    y = 270;
    pages.push(cur);
  };
  const BOTTOM = H - 120;
  const section = (title, text) => {
    const t = String(text || '').trim();
    if (!t) return;
    if (!cur || y > BOTTOM - 160) startPage();
    let { x } = cur;
    x.textAlign = 'left'; x.fillStyle = NAVY; x.font = font(800, 44); x.fillText(title, MARGIN, y);
    x.fillStyle = GOLD; x.fillRect(MARGIN, y + 16, 120, 8);
    y += 84;
    const FS = 30, LH = 46;
    for (const raw of t.split('\n')) {
      const line = raw.trim();
      if (!line) { y += 18; continue; }
      const m = line.match(/^(\d+[.)]|[-•*])\s+(.*)$/);
      const marker = m ? (/^[-*]$/.test(m[1]) ? '•' : m[1]) : '•';
      const body = m ? m[2] : line;
      ({ x } = cur);
      x.font = font(700, FS);
      const mw = Math.max(x.measureText(marker).width + 18, 44);
      x.font = font(400, FS);
      const lines = wrap(x, body, W - MARGIN * 2 - mw);
      for (let i = 0; i < lines.length; i++) {
        if (y > BOTTOM) { startPage(); ({ x } = cur); }
        x.textAlign = 'left';
        if (i === 0) { x.fillStyle = BLUE; x.font = font(700, FS); x.fillText(marker, MARGIN, y); }
        x.fillStyle = INK; x.font = font(400, FS); x.fillText(lines[i], MARGIN + mw, y);
        y += LH;
      }
      y += 8;
    }
    y += 40;
  };
  section('Terms & Conditions', d.terms);
  section('Gym Rules', d.rules);
  pages.forEach(({ x }, i) => {
    x.textAlign = 'center'; x.fillStyle = MUT; x.font = font(400, 22);
    x.fillText(`${d.gym || ''}  ·  Invoice ${d.no}  ·  Page ${i + 2} of ${pages.length + 1}`, W / 2, H - 62);
    strip(x);
  });
  return pages.map((p) => p.c);
}

export async function renderInvoicePages(d) {
  const [brand, custom] = await Promise.all([loadImg('/icons/logo.png'), loadImg(d.logo)]);
  const pages = [invoicePage(d, brand, custom)];
  if ((d.terms || '').trim() || (d.rules || '').trim()) pages.push(...termsPages(d, brand, custom));
  return pages;
}

// ---------------------------------------------------------------- PDF / print / share
let jsPdfLoading;
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = res;
    s.onerror = () => rej(new Error('load failed: ' + src));
    document.head.appendChild(s);
  });
}
// PDF library is bundled in /vendor (works offline); CDN is only a backup.
function loadJsPDF() {
  if (window.jspdf) return Promise.resolve(window.jspdf.jsPDF);
  jsPdfLoading ||= (async () => {
    for (const src of ['/vendor/jspdf.umd.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js']) {
      try {
        await loadScript(src);
        if (window.jspdf) return window.jspdf.jsPDF;
      } catch {}
    }
    jsPdfLoading = null;
    throw new Error('Could not create the PDF. Please use the Print button and choose "Save as PDF".');
  })();
  return jsPdfLoading;
}

export async function invoiceBlob(d) {
  const [JsPDF, pages] = await Promise.all([loadJsPDF(), renderInvoicePages(d)]);
  const doc = new JsPDF({ unit: 'mm', format: 'a4', compress: true });
  pages.forEach((c, i) => {
    if (i) doc.addPage();
    doc.addImage(c.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
  });
  return doc.output('blob');
}

export async function printInvoice(d) {
  const pages = await renderInvoicePages(d);
  const imgs = pages.map((c) => `<img src="${c.toDataURL('image/jpeg', 0.92)}">`).join('');
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(f);
  f.onload = () => {
    f.contentWindow.focus();
    f.contentWindow.print();
    setTimeout(() => f.remove(), 4000);
  };
  f.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><title>Invoice ${d.no}</title><style>
@page{size:A4;margin:0}html,body{margin:0;padding:0}
img{display:block;width:210mm;height:297mm;page-break-after:always;break-after:page}
img:last-child{page-break-after:auto;break-after:auto}
</style></head><body>${imgs}</body></html>`;
}

const rs = (n) => 'Rs. ' + (Math.round((+n || 0) * 100) / 100).toLocaleString('en-IN');

export async function shareInvoiceWhatsApp(d, waLinkFn, downloadFn) {
  const blob = await invoiceBlob(d);
  const file = new File([blob], `Invoice-${d.no}.pdf`, { type: 'application/pdf' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: `Invoice ${d.no} - ${d.gym}` });
      return 'shared';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled';
    }
  }
  // Fallback (laptop): download the PDF and open WhatsApp with a text summary
  downloadFn(`Invoice-${d.no}.pdf`, blob);
  const msg = `Hello ${d.name}, thank you for your payment of ${rs(d.paid)} at ${d.gym}.\nInvoice: ${d.no}\nPlan: ${d.plan} (${fmtDate(d.start)} to ${fmtDate(d.due)})\nBalance due: ${rs(d.balance)}`;
  window.open(waLinkFn(d.phone, msg), '_blank');
  return 'fallback';
}
