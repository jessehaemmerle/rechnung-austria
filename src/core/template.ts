import { isSmallAmountInvoice } from './compliance';
import { formatDate } from './dates';
import { formatEuro } from './money';
import { computeTotals, paidAmount } from './tax';
import { kindLabel, t, type DocTextKey } from './i18n';
import type { BusinessDocument, CompanySettings, Customer, DunningRecord, Language } from './types';

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const nl2br = (s: string) => escapeHtml(s).replace(/\n/g, '<br>');

/** Nur Bild-Data-URLs zulassen, damit das Logo keine Fremdinhalte nachladen kann. */
function safeLogo(logo: string): string {
  return /^data:image\/(png|jpe?g|svg\+xml|webp);base64,[A-Za-z0-9+/=]+$/.test(logo) ? logo : '';
}

const STYLE = `
@page { size: A4; margin: 18mm 18mm 22mm 20mm; }
* { box-sizing: border-box; }
body { font-family: "Helvetica Neue", Arial, sans-serif; font-size: 9.5pt; color: #1a1a1a; margin: 0; line-height: 1.4; }
.head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14mm; }
.logo { max-height: 22mm; max-width: 60mm; }
.sender { text-align: right; font-size: 8.5pt; color: #444; }
.sender strong { font-size: 11pt; color: #111; }
.sender-line { font-size: 7pt; color: #666; border-bottom: 0.5pt solid #999; display: inline-block; margin-bottom: 2mm; }
.addr-row { display: flex; justify-content: space-between; margin-bottom: 12mm; }
.recipient { width: 85mm; min-height: 32mm; }
.meta { font-size: 9pt; }
.meta td { padding: 0.5mm 0 0.5mm 6mm; }
.meta td:first-child { color: #555; padding-left: 0; }
h1 { font-size: 16pt; margin: 0 0 4mm; font-weight: 600; }
.intro, .closing { margin: 4mm 0; }
table.items { width: 100%; border-collapse: collapse; margin-top: 4mm; }
table.items th { text-align: left; border-bottom: 1pt solid #222; padding: 1.5mm 1mm; font-weight: 600; font-size: 8.5pt; }
table.items td { border-bottom: 0.5pt solid #ddd; padding: 1.5mm 1mm; vertical-align: top; }
table.items tr { page-break-inside: avoid; }
.num { text-align: right; white-space: nowrap; }
.totals { margin-left: auto; margin-top: 4mm; width: 80mm; border-collapse: collapse; }
.totals td { padding: 1mm; }
.totals tr.grand td { border-top: 1pt solid #222; font-weight: 700; font-size: 11pt; }
.note { margin-top: 5mm; padding: 2.5mm 3mm; background: #f3f3f3; border-left: 2pt solid #555; }
.payment { margin-top: 6mm; }
.footer { position: fixed; bottom: -14mm; left: 0; right: 0; font-size: 7pt; color: #666; display: flex; justify-content: space-between; border-top: 0.5pt solid #ccc; padding-top: 1.5mm; }
.footer div { flex: 1; }
`;

function addressBlock(name: string, extra: string, a: { street: string; zip: string; city: string; country: string }): string {
  return [name, extra, a.street, `${a.zip} ${a.city}`, a.country && a.country !== 'AT' ? a.country : '']
    .filter((l) => l && l.trim())
    .map(escapeHtml)
    .join('<br>');
}

function header(s: CompanySettings): string {
  const logo = safeLogo(s.logo);
  return `<div class="head">
    <div>${logo ? `<img class="logo" src="${logo}" alt="">` : ''}</div>
    <div class="sender"><strong>${escapeHtml(s.name)}</strong><br>${addressBlock('', s.owner && s.owner !== s.name ? s.owner : '', s.address)}
    ${s.phone ? `<br>${escapeHtml(s.phone)}` : ''}${s.email ? `<br>${escapeHtml(s.email)}` : ''}${s.website ? `<br>${escapeHtml(s.website)}` : ''}</div>
  </div>`;
}

function footer(s: CompanySettings, lang: Language): string {
  const col1 = [s.name, s.address.street, `${s.address.zip} ${s.address.city}`].filter(Boolean).map(escapeHtml).join('<br>');
  const col2 = [
    s.vatId ? `${t(lang, 'vatId')}: ${s.vatId}` : '',
    s.taxNumber ? `${t(lang, 'taxNumber')}: ${s.taxNumber}` : '',
    s.registerInfo,
  ]
    .filter(Boolean)
    .map(escapeHtml)
    .join('<br>');
  const col3 = [s.bankName, s.iban ? `IBAN ${s.iban}` : '', s.bic ? `BIC ${s.bic}` : ''].filter(Boolean).map(escapeHtml).join('<br>');
  return `<div class="footer"><div>${col1}</div><div>${col2}</div><div>${col3}</div></div>`;
}

function page(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<style>${STYLE}</style></head><body>${body}</body></html>`;
}

export interface RenderInput {
  doc: BusinessDocument;
  settings: CompanySettings;
  customer: Customer | undefined;
  sourceNumber?: string;
}

export function renderDocumentHtml({ doc, settings, customer, sourceNumber }: RenderInput): string {
  const lang = doc.language;
  const totals = computeTotals(doc, settings);
  const eur = (c: number) => formatEuro(c, lang);
  const small = doc.kind !== 'offer' && isSmallAmountInvoice(doc, settings) && totals.groups.length === 1 && !totals.exemption;
  const title = `${kindLabel(doc.kind, lang)} ${doc.number || ''}`.trim();

  const metaRows: [DocTextKey, string][] = [
    ['number', doc.number || (lang === 'de' ? 'Entwurf' : 'Draft')],
    ['date', formatDate(doc.issueDate, lang)],
  ];
  if (doc.kind !== 'offer' && doc.serviceDateFrom) {
    metaRows.push(
      doc.serviceDateTo && doc.serviceDateTo !== doc.serviceDateFrom
        ? ['servicePeriod', `${formatDate(doc.serviceDateFrom, lang)} – ${formatDate(doc.serviceDateTo, lang)}`]
        : ['serviceDate', formatDate(doc.serviceDateFrom, lang)],
    );
  }
  if (doc.kind === 'offer' && doc.validUntil) metaRows.push(['validUntil', formatDate(doc.validUntil, lang)]);
  if (doc.kind === 'invoice' && doc.dueDate) metaRows.push(['dueDate', formatDate(doc.dueDate, lang)]);
  if (customer?.number) metaRows.push(['customerNo', customer.number]);
  if (customer?.vatId) metaRows.push(['customerVatId', customer.vatId]);

  const showDiscount = doc.items.some((i) => i.discountPercent);
  const showVatCol = !totals.exemption && totals.groups.length > 1;
  const rows = totals.lines
    .map(
      (l, i) => `<tr><td>${i + 1}</td><td>${nl2br(l.item.description)}</td>
      <td class="num">${l.item.quantity.toLocaleString(lang === 'de' ? 'de-AT' : 'en-GB')} ${escapeHtml(l.item.unit)}</td>
      <td class="num">${eur(l.item.unitPrice)}</td>
      ${showDiscount ? `<td class="num">${l.item.discountPercent ? `${l.item.discountPercent} %` : ''}</td>` : ''}
      ${showVatCol ? `<td class="num">${l.vatRate} %</td>` : ''}
      <td class="num">${eur(l.net)}</td></tr>`,
    )
    .join('');

  let totalsHtml: string;
  if (small) {
    totalsHtml = `<tr class="grand"><td>${t(lang, 'smallInvoiceTotal', { rate: totals.groups[0].rate })}</td><td class="num">${eur(totals.gross)}</td></tr>`;
  } else if (totals.exemption) {
    totalsHtml = `<tr class="grand"><td>${t(lang, 'gross')}</td><td class="num">${eur(totals.gross)}</td></tr>`;
  } else {
    totalsHtml =
      `<tr><td>${t(lang, 'net')}</td><td class="num">${eur(totals.net)}</td></tr>` +
      totals.groups.map((g) => `<tr><td>${t(lang, 'vatAmount', { rate: g.rate, base: eur(g.net) })}</td><td class="num">${eur(g.vat)}</td></tr>`).join('') +
      `<tr class="grand"><td>${t(lang, 'gross')}</td><td class="num">${eur(totals.gross)}</td></tr>`;
  }

  const notes: string[] = [];
  if (totals.exemption === 'small_business') notes.push(t(lang, 'smallBusiness'));
  if (totals.exemption === 'reverse_charge') notes.push(t(lang, 'reverseCharge'));
  if (totals.exemption === 'ig_delivery') notes.push(t(lang, 'igDelivery'));
  if (sourceNumber && doc.kind === 'credit_note') notes.push(t(lang, 'refersTo', { number: sourceNumber }));

  const open = totals.gross - paidAmount(doc);
  const payment =
    doc.kind === 'invoice' && settings.iban && open > 0
      ? `<div class="payment">${escapeHtml(t(lang, 'paymentInfo', { amount: eur(open), date: formatDate(doc.dueDate, lang) }))}<br>
         ${escapeHtml(settings.name)} · IBAN ${escapeHtml(settings.iban)}${settings.bic ? ` · BIC ${escapeHtml(settings.bic)}` : ''}</div>`
      : '';

  const body = `${header(settings)}
  <div class="addr-row">
    <div class="recipient"><span class="sender-line">${escapeHtml([settings.name, settings.address.street, `${settings.address.zip} ${settings.address.city}`].filter((x) => x.trim()).join(' · '))}</span><br>
      ${customer ? addressBlock(customer.name, customer.contactPerson, customer.address) : ''}</div>
    <table class="meta">${metaRows.map(([k, v]) => `<tr><td>${t(lang, k)}</td><td>${escapeHtml(v)}</td></tr>`).join('')}</table>
  </div>
  <h1>${escapeHtml(doc.title || title)}</h1>
  ${doc.title ? `<div>${escapeHtml(title)}</div>` : ''}
  ${doc.introText ? `<div class="intro">${nl2br(doc.introText)}</div>` : ''}
  <table class="items"><thead><tr><th>${t(lang, 'pos')}</th><th>${t(lang, 'description')}</th><th class="num">${t(lang, 'quantity')}</th>
    <th class="num">${t(lang, 'unitPrice')}</th>${showDiscount ? `<th class="num">${t(lang, 'discount')}</th>` : ''}${showVatCol ? `<th class="num">${t(lang, 'vat')}</th>` : ''}
    <th class="num">${t(lang, 'total')}</th></tr></thead><tbody>${rows}</tbody></table>
  <table class="totals">${totalsHtml}</table>
  ${notes.map((n) => `<div class="note">${escapeHtml(n)}</div>`).join('')}
  ${doc.closingText ? `<div class="closing">${nl2br(doc.closingText)}</div>` : ''}
  ${payment}
  ${settings.footerNote ? `<div class="closing">${nl2br(settings.footerNote)}</div>` : ''}
  ${footer(settings, lang)}`;
  return page(title, body);
}

export function renderDunningHtml(
  input: RenderInput & { record: DunningRecord },
): string {
  const { doc, settings, customer, record } = input;
  const lang = doc.language;
  const eur = (c: number) => formatEuro(c, lang);
  const titleKey = (['reminder1', 'reminder2', 'reminder3'] as const)[record.level - 1];
  const gross = computeTotals(doc, settings).gross;
  const outstanding = gross - paidAmount(doc);
  const prior = doc.dunning.filter((d) => d.level < record.level);
  const fees = prior.reduce((s, d) => s + d.fee, 0) + record.fee;
  const interest = prior.reduce((s, d) => s + d.interest, 0) + record.interest;

  const body = `${header(settings)}
  <div class="addr-row">
    <div class="recipient">${customer ? addressBlock(customer.name, customer.contactPerson, customer.address) : ''}</div>
    <table class="meta"><tr><td>${t(lang, 'date')}</td><td>${formatDate(record.date, lang)}</td></tr>
      <tr><td>${t(lang, 'invoice')}</td><td>${escapeHtml(doc.number)}</td></tr>
      <tr><td>${t(lang, 'date')} ${t(lang, 'invoice')}</td><td>${formatDate(doc.issueDate, lang)}</td></tr>
      <tr><td>${t(lang, 'dueDate')}</td><td>${formatDate(doc.dueDate, lang)}</td></tr></table>
  </div>
  <h1>${t(lang, titleKey)}</h1>
  <p>${t(lang, 'greeting')}</p>
  <p>${t(lang, 'reminderIntro')}</p>
  <table class="totals" style="margin-left:0;width:110mm">
    <tr><td>${t(lang, 'reminderOutstanding')}</td><td class="num">${eur(outstanding)}</td></tr>
    ${fees ? `<tr><td>${t(lang, 'reminderFees')}</td><td class="num">${eur(fees)}</td></tr>` : ''}
    ${interest ? `<tr><td>${t(lang, 'reminderInterest')}</td><td class="num">${eur(interest)}</td></tr>` : ''}
    <tr class="grand"><td>${t(lang, 'reminderTotal')}</td><td class="num">${eur(outstanding + fees + interest)}</td></tr>
  </table>
  <p>${escapeHtml(t(lang, 'reminderPayBy', { date: formatDate(record.dueDate, lang) }))}</p>
  ${settings.iban ? `<p>IBAN ${escapeHtml(settings.iban)}${settings.bic ? ` · BIC ${escapeHtml(settings.bic)}` : ''}</p>` : ''}
  <p>${t(lang, 'regards')}<br>${escapeHtml(settings.owner || settings.name)}</p>
  ${footer(settings, lang)}`;
  return page(`${t(lang, titleKey)} ${doc.number}`, body);
}
