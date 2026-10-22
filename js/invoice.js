// Invoice: A4 print layout, PDF download (jsPDF) and WhatsApp share
import { esc, money, fmtDate } from './util.js';

export function invoiceData(settings, m, p) {
  const s = p.snap || {};
  return {
    gym: settings.gymName,
    gymPhone: settings.phone,
    logo: settings.logo,
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

export function invoiceHTML(d) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Invoice ${esc(d.no)}</title>
<style>
@page{size:A4;margin:14mm}
*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0;font-size:14px}
.top{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #4f46e5;padding-bottom:12px}
.top img{height:64px;margin-right:12px}.brand{display:flex;align-items:center}
h1{margin:0;font-size:22px}.inv{text-align:right}.inv b{font-size:20px;color:#4f46e5}
.meta{display:flex;justify-content:space-between;margin:22px 0}
table{width:100%;border-collapse:collapse;margin-top:10px}
td,th{padding:10px;border-bottom:1px solid #ddd;text-align:left}th{background:#f1f2fb}
td.r,th.r{text-align:right}.tot td{font-weight:bold;border-top:2px solid #111}
.foot{margin-top:40px;text-align:center;color:#666;font-size:12px}
</style></head><body>
<div class="top"><div class="brand">${d.logo ? `<img src="${d.logo}">` : ''}<div><h1>${esc(d.gym)}</h1>${d.gymPhone ? `<div>Ph: ${esc(d.gymPhone)}</div>` : ''}</div></div>
<div class="inv"><b>INVOICE</b><div>No: ${esc(d.no)}</div><div>Date: ${fmtDate(d.date)}</div></div></div>
<div class="meta"><div><b>Billed to</b><br>${esc(d.name)}<br>${esc(d.phone)}</div>
<div style="text-align:right"><b>Membership validity</b><br>${fmtDate(d.start)} to ${fmtDate(d.due)}</div></div>
<table><tr><th>Description</th><th class="r">Amount</th></tr>
<tr><td>${esc(d.plan)} gym membership</td><td class="r">${money(d.price)}</td></tr>
<tr><td>Discount</td><td class="r">- ${money(d.discount)}</td></tr>
<tr class="tot"><td>Amount paid (${esc(d.mode)})</td><td class="r">${money(d.paid)}</td></tr>
<tr><td>Balance due</td><td class="r">${money(d.balance)}</td></tr></table>
<div class="foot">Thank you for training with ${esc(d.gym)}!</div>
</body></html>`;
}

export function printInvoice(d) {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(f);
  f.onload = () => {
    f.contentWindow.focus();
    f.contentWindow.print();
    setTimeout(() => f.remove(), 3000);
  };
  f.srcdoc = invoiceHTML(d);
}

let jsPdfLoading;
function loadJsPDF() {
  if (window.jspdf) return Promise.resolve(window.jspdf.jsPDF);
  jsPdfLoading ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    s.onload = () => res(window.jspdf.jsPDF);
    s.onerror = () => rej(new Error('Could not load PDF library (check internet)'));
    document.head.appendChild(s);
  });
  return jsPdfLoading;
}

const rs = (n) => 'Rs. ' + (Math.round((+n || 0) * 100) / 100).toLocaleString('en-IN');

export async function invoiceBlob(d) {
  const JsPDF = await loadJsPDF();
  const doc = new JsPDF({ unit: 'mm', format: 'a4' });
  let x = 15;
  if (d.logo) {
    try {
      doc.addImage(d.logo, 'JPEG', 15, 12, 22, 22);
      x = 42;
    } catch {}
  }
  doc.setFont('helvetica', 'bold').setFontSize(18).text(d.gym || 'Gym', x, 22);
  doc.setFont('helvetica', 'normal').setFontSize(10);
  if (d.gymPhone) doc.text('Ph: ' + d.gymPhone, x, 28);
  doc.setFont('helvetica', 'bold').setFontSize(16).setTextColor(79, 70, 229).text('INVOICE', 195, 20, { align: 'right' });
  doc.setTextColor(0).setFont('helvetica', 'normal').setFontSize(10);
  doc.text('No: ' + d.no, 195, 26, { align: 'right' });
  doc.text('Date: ' + fmtDate(d.date), 195, 31, { align: 'right' });
  doc.setDrawColor(79, 70, 229).setLineWidth(0.8).line(15, 38, 195, 38);

  doc.setFont('helvetica', 'bold').text('Billed to', 15, 48);
  doc.setFont('helvetica', 'normal').text(d.name, 15, 54).text(String(d.phone), 15, 59);
  doc.setFont('helvetica', 'bold').text('Membership validity', 195, 48, { align: 'right' });
  doc.setFont('helvetica', 'normal').text(`${fmtDate(d.start)} to ${fmtDate(d.due)}`, 195, 54, { align: 'right' });

  let y = 75;
  doc.setFillColor(241, 242, 251).rect(15, y - 6, 180, 9, 'F');
  doc.setFont('helvetica', 'bold').text('Description', 18, y).text('Amount', 192, y, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  const rows = [
    [`${d.plan} gym membership`, rs(d.price)],
    ['Discount', '- ' + rs(d.discount)],
    [`Amount paid (${d.mode})`, rs(d.paid)],
    ['Balance due', rs(d.balance)],
  ];
  rows.forEach((r, i) => {
    y += 10;
    if (i === 2) doc.setFont('helvetica', 'bold');
    doc.text(r[0], 18, y).text(r[1], 192, y, { align: 'right' });
    doc.setFont('helvetica', 'normal').setDrawColor(220).setLineWidth(0.2).line(15, y + 3, 195, y + 3);
  });
  doc.setFontSize(9).setTextColor(110).text(`Thank you for training with ${d.gym}!`, 105, y + 25, { align: 'center' });
  return doc.output('blob');
}

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
