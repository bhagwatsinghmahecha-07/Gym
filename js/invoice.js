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

// gym name in logo-style lettering: first word light blue, rest yellow
const LBLUE = '#2fa8ff';
const BFONT = (px) => `italic 900 ${px}px "Exo 2 Brand","Arial Black",Arial,sans-serif`;
function brandName(x, name, px, left, base, align) {
  const w = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return;
  const parts = [[w[0].toUpperCase(), LBLUE]];
  if (w.length > 1) parts.push([w.slice(1).join(' ').toUpperCase(), GOLD]);
  x.font = BFONT(px);
  const gap = px * 0.28;
  const tot = parts.reduce((n, p) => n + x.measureText(p[0]).width, 0) + gap * (parts.length - 1);
  let cx = align === 'right' ? left - tot : left;
  x.textAlign = 'left';
  for (const [t, col] of parts) {
    const tw = x.measureText(t).width;
    const g = x.createLinearGradient(0, base - px * 0.78, 0, base + px * 0.06);
    if (col === GOLD) { g.addColorStop(0, '#fff6a8'); g.addColorStop(0.24, '#f7e642'); g.addColorStop(0.54, '#f8c910'); g.addColorStop(1, '#d98d00'); }
    else { g.addColorStop(0, '#d4f8ff'); g.addColorStop(0.24, '#3fe6f7'); g.addColorStop(0.52, '#13bff3'); g.addColorStop(1, '#0a78d8'); }
    x.save();
    x.shadowColor = 'rgba(20,170,255,.6)'; x.shadowBlur = px * 0.4;
    x.fillStyle = 'rgba(0,35,85,.85)'; x.fillText(t, cx, base + Math.max(2, px * 0.05));
    x.restore();
    x.fillStyle = g; x.fillText(t, cx, base);
    cx += tw + gap;
  }
}
function footer(x, text) {
  x.fillStyle = NAVY; x.fillRect(0, H - 84, W, 84);
  x.fillStyle = GOLD; x.fillRect(0, H - 90, W, 6);
  x.fillStyle = '#cfe0f5'; x.font = font(500, 24); x.textAlign = 'center';
  x.fillText(text, W / 2, H - 36);
}
function rrect(x, px, py, w, h, r) {
  x.beginPath();
  x.roundRect ? x.roundRect(px, py, w, h, r) : x.rect(px, py, w, h);
}
function infoBox(x, px, py, w, h, title, l1, l2, l3) {
  x.fillStyle = '#fff'; rrect(x, px, py, w, h, 12); x.fill();
  x.strokeStyle = LINE; x.lineWidth = 2; x.stroke();
  x.fillStyle = BLUE; rrect(x, px, py, 8, h, 4); x.fill();
  x.textAlign = 'left';
  x.fillStyle = BLUE; x.font = font(700, 21); x.fillText(title, px + 34, py + 44);
  x.fillStyle = INK; x.font = font(700, 36); x.fillText(l1 || '', px + 34, py + 94);
  x.fillStyle = MUT; x.font = font(400, 28);
  x.fillText(l2 || '', px + 34, py + 138);
  if (l3) x.fillText(l3, px + 34, py + 178);
}

function invoicePage(d, brand, custom, total) {
  const { c, x } = newPage();
  band(x, 270);
  drawBrand(x, brand, custom, MARGIN, 40, 520, 190);
  // gym name (logo-style lettering) + contact on the right
  brandName(x, d.gym, 58, W - MARGIN, 125, 'right');
  x.textAlign = 'right'; x.fillStyle = '#cfe0f5'; x.font = font(500, 27);
  let cy = 176;
  if (d.gymPhone) { x.fillText('Phone: ' + d.gymPhone, W - MARGIN, cy); cy += 40; }

  // title + invoice no / date
  x.textAlign = 'left'; x.fillStyle = NAVY; x.font = font(800, 82); x.fillText('INVOICE', MARGIN, 400);
  const iw = x.measureText('INVOICE').width;
  x.fillStyle = GOLD; x.fillText('.', MARGIN + iw + 4, 400);
  const mw = 400, mh = 120, mx = W - MARGIN - mw, my = 316;
  x.fillStyle = '#f1f6fc'; rrect(x, mx, my, mw, mh, 14); x.fill();
  x.textAlign = 'left'; x.fillStyle = MUT; x.font = font(700, 22);
  x.fillText('INVOICE NO.', mx + 28, my + 44); x.fillText('DATE', mx + 28, my + 90);
  x.textAlign = 'right'; x.fillStyle = INK; x.font = font(700, 28);
  x.fillText(String(d.no), mx + mw - 28, my + 44); x.fillText(fmtDate(d.date), mx + mw - 28, my + 90);

  // billed to / membership
  const bw = (W - MARGIN * 2 - 30) / 2, by = 480, bh = 206;
  infoBox(x, MARGIN, by, bw, bh, 'BILLED TO', d.name || '', d.phone ? 'Phone: ' + d.phone : '');
  infoBox(x, MARGIN + bw + 30, by, bw, bh, 'MEMBERSHIP', d.plan || '', 'From: ' + fmtDate(d.start), 'Valid till: ' + fmtDate(d.due));

  // items table
  const tx = MARGIN, tw = W - MARGIN * 2;
  let y = 745;
  x.fillStyle = NAVY; x.fillRect(tx, y, tw, 74);
  x.fillStyle = GOLD; x.font = font(700, 24);
  x.textAlign = 'left'; x.fillText('DESCRIPTION', tx + 28, y + 48);
  x.textAlign = 'right'; x.fillText('AMOUNT', tx + tw - 28, y + 48);
  y += 74;
  const rows = [[`${d.plan || ''} gym membership`, money(d.price)]];
  if (d.discount > 0) rows.push(['Discount', '- ' + money(d.discount)]);
  rows.forEach(([a, b2], i) => {
    const rh = 86;
    if (i % 2) { x.fillStyle = '#f7fafd'; x.fillRect(tx, y, tw, rh); }
    x.fillStyle = INK; x.font = font(400, 31);
    x.textAlign = 'left'; x.fillText(a, tx + 28, y + 55);
    x.textAlign = 'right'; x.fillText(b2, tx + tw - 28, y + 55);
    x.fillStyle = LINE; x.fillRect(tx, y + rh - 2, tw, 2);
    y += rh;
  });

  // summary
  const sw = 520, sx = W - MARGIN - sw;
  y += 30;
  const net = (+d.price || 0) - (+d.discount || 0);
  x.textAlign = 'left'; x.fillStyle = MUT; x.font = font(600, 24);
  x.fillText('PAYMENT MODE', MARGIN, y + 36);
  x.fillStyle = INK; x.font = font(700, 32); x.fillText(String(d.mode || '-'), MARGIN, y + 82);
  const line = (a, b2) => {
    x.textAlign = 'left'; x.fillStyle = INK; x.font = font(500, 30); x.fillText(a, sx + 24, y + 40);
    x.textAlign = 'right'; x.fillText(b2, sx + sw - 24, y + 40);
    y += 64;
  };
  line('Total', money(net));
  line('Amount paid', money(d.paid));
  x.fillStyle = NAVY; rrect(x, sx, y, sw, 92, 12); x.fill();
  x.textAlign = 'left'; x.fillStyle = '#fff'; x.font = font(700, 32); x.fillText('Balance due', sx + 24, y + 59);
  x.textAlign = 'right'; x.fillStyle = d.balance > 0 ? '#ff7a7a' : '#4ade80'; x.font = font(800, 38);
  x.fillText(money(d.balance), sx + sw - 24, y + 61);
  y += 92;

  x.textAlign = 'center';
  x.fillStyle = NAVY; x.font = font(700, 34); x.fillText(`Thank you for training with ${d.gym || 'us'}!`, W / 2, y + 150);
  if ((d.terms || '').trim() || (d.rules || '').trim()) {
    x.fillStyle = MUT; x.font = font(400, 27);
    x.fillText('Please read the Terms & Conditions and Rules on the next page.', W / 2, y + 204);
  }
  footer(x, `${d.gym || ''}  •  Invoice ${d.no}  •  Page 1 of ${total}`);
  return c;
}

// Terms / rules pages (may run over several pages)
function icon(x, kind, cx, cy) {
  x.save();
  x.fillStyle = GOLD; x.beginPath(); x.arc(cx, cy, 27, 0, Math.PI * 2); x.fill();
  x.strokeStyle = NAVY; x.lineWidth = 4; x.lineCap = 'round'; x.lineJoin = 'round';
  if (kind === 'doc') {
    x.strokeRect(cx - 10, cy - 14, 20, 28);
    x.beginPath(); x.moveTo(cx - 5, cy - 5); x.lineTo(cx + 5, cy - 5); x.moveTo(cx - 5, cy + 2); x.lineTo(cx + 5, cy + 2); x.moveTo(cx - 5, cy + 9); x.lineTo(cx + 1, cy + 9); x.stroke();
  } else {
    x.beginPath(); x.moveTo(cx - 12, cy); x.lineTo(cx - 3, cy + 10); x.lineTo(cx + 13, cy - 10); x.stroke();
  }
  x.restore();
}
function termsPages(d, brand, custom) {
  const pages = [];
  let cur = null, y = 0;
  const BOTTOM = H - 150;
  const startPage = () => {
    cur = newPage();
    const { x } = cur;
    if (brand) { // soft watermark so the page never looks empty
      x.save(); x.globalAlpha = 0.06;
      const dm = contain(brand, 1000, 640);
      x.drawImage(brand, (W - dm.w) / 2, (H - dm.h) / 2 + 80, dm.w, dm.h);
      x.restore();
    }
    band(x, 230);
    drawBrand(x, brand, custom, MARGIN, 34, 420, 160);
    x.textAlign = 'right';
    x.fillStyle = GOLD; x.font = font(800, 56); x.fillText('TERMS & RULES', W - MARGIN, 108);
    x.fillStyle = '#d6e8fa'; x.font = font(500, 26); x.fillText(`Please read carefully  •  Invoice ${d.no}`, W - MARGIN, 160);
    y = 300;
    pages.push(cur);
  };
  const section = (title, text, kind) => {
    const t = String(text || '').trim();
    if (!t) return;
    if (!cur || y > BOTTOM - 260) startPage();
    let { x } = cur;
    const heading = () => {
      ({ x } = cur);
      x.fillStyle = NAVY; rrect(x, MARGIN, y, W - MARGIN * 2, 88, 14); x.fill();
      x.fillStyle = GOLD; x.fillRect(MARGIN, y + 20, 8, 48);
      icon(x, kind, MARGIN + 58, y + 44);
      x.textAlign = 'left'; x.fillStyle = '#fff'; x.font = font(800, 36); x.fillText(title.toUpperCase(), MARGIN + 110, y + 57);
      y += 88 + 22;
    };
    heading();
    const FS = 30, LH = 44, TX = MARGIN + 96, TW = W - MARGIN * 2 - 96 - 28;
    let n = 0;
    for (const raw of t.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const m = line.match(/^(\d+[.)]|[-•*])\s+(.*)$/);
      const body = m ? m[2] : line;
      n++;
      ({ x } = cur);
      x.font = font(400, FS);
      const lines = wrap(x, body, TW);
      const rh = lines.length * LH + 34;
      if (y + rh > BOTTOM) { startPage(); heading(); ({ x } = cur); }
      x.fillStyle = n % 2 ? '#f1f6fc' : '#ffffff';
      rrect(x, MARGIN, y, W - MARGIN * 2, rh, 12); x.fill();
      x.strokeStyle = LINE; x.lineWidth = 2; x.stroke();
      // number badge
      x.fillStyle = BLUE; x.beginPath(); x.arc(MARGIN + 50, y + rh / 2, 25, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#fff'; x.font = font(800, 26); x.textAlign = 'center'; x.fillText(String(n), MARGIN + 50, y + rh / 2 + 9);
      x.textAlign = 'left'; x.fillStyle = INK; x.font = font(400, FS);
      lines.forEach((l, i) => x.fillText(l, TX, y + 17 + LH * (i + 1) - 11));
      y += rh + 12;
    }
    y += 34;
  };
  section('Terms & Conditions', d.terms, 'doc');
  section('Gym Rules', d.rules, 'check');
  pages.forEach(({ x }, i) => footer(x, `${d.gym || ''}  •  Invoice ${d.no}  •  Page ${i + 2} of ${pages.length + 1}`));
  return pages.map((p) => p.c);
}

export async function renderInvoicePages(d) {
  const [brand, custom] = await Promise.all([loadImg('/icons/logo.png'), loadImg(d.logo), document.fonts.load('italic 900 40px "Exo 2 Brand"').catch(() => {})]);
  const hasTerms = (d.terms || '').trim() || (d.rules || '').trim();
  const rest = hasTerms ? termsPages(d, brand, custom) : [];
  return [invoicePage(d, brand, custom, 1 + rest.length), ...rest];
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
