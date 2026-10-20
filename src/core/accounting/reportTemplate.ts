import { formatDate } from '../dates';
import { formatEuro } from '../money';
import { escapeHtml } from '../template';
import type { CompanySettings, Database } from '../types';
import { afaSchedule } from './assets';
import { accountBalance } from './bank';
import { e1aSummary, earReport } from './ear';
import { estimateTaxes } from './estimate';
import { kmAllowanceForYear } from './trips';
import { computeUva, vatDueDate, type VatPeriod } from './vat';

const eur = (c: number) => escapeHtml(formatEuro(c));
const d = (iso: string) => escapeHtml(formatDate(iso));

const STYLE = `
@page { size: A4; margin: 16mm 16mm 18mm 18mm; }
body { font-family: "Helvetica Neue", Arial, sans-serif; font-size: 9pt; color: #1a1a1a; margin: 0; }
h1 { font-size: 15pt; margin: 0 0 1mm; } h2 { font-size: 11pt; margin: 7mm 0 2mm; }
.meta { color: #555; margin-bottom: 5mm; }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; border-bottom: 1pt solid #222; padding: 1.2mm 1mm; font-weight: 600; }
td { border-bottom: 0.5pt solid #ddd; padding: 1.2mm 1mm; vertical-align: top; }
tr { page-break-inside: avoid; }
.num { text-align: right; white-space: nowrap; }
.kz { width: 14mm; color: #555; }
tr.sum td { border-top: 1pt solid #222; font-weight: 700; }
.note { margin-top: 6mm; color: #555; font-size: 8pt; }
`;

function page(title: string, s: CompanySettings, sub: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>${STYLE}</style></head><body>
<h1>${escapeHtml(title)}</h1>
<div class="meta">${escapeHtml(s.name)}${s.taxNumber ? ` · St.-Nr. ${escapeHtml(s.taxNumber)}` : ''}${s.vatId ? ` · UID ${escapeHtml(s.vatId)}` : ''} · ${escapeHtml(sub)}</div>
${body}
<div class="note">Erstellt mit Rechnung Austria am ${d(new Date().toISOString().slice(0, 10))}. Hilfsaufstellung – keine Steuerberatung.</div>
</body></html>`;
}

const row = (kz: string, label: string, v: number) => `<tr><td class="kz">${escapeHtml(kz)}</td><td>${escapeHtml(label)}</td><td class="num">${eur(v)}</td></tr>`;

export function renderUvaHtml(db: Database, period: VatPeriod): string {
  const u = computeUva(db, period);
  const body = `<table>
  <tr><th class="kz">KZ</th><th>Bezeichnung</th><th class="num">Betrag</th></tr>
  ${row('000', 'Gesamtbetrag der Bemessungsgrundlagen für Lieferungen und sonstige Leistungen', u.kz000)}
  ${u.kz017 ? row('017', 'davon steuerfrei: innergemeinschaftliche Lieferungen', u.kz017) : ''}
  ${u.kz016 ? row('016', 'davon steuerfrei ohne Vorsteuerabzug (Kleinunternehmer)', u.kz016) : ''}
  ${row('022', 'zu versteuern mit 20 % – Bemessungsgrundlage', u.kz022)}${row('', 'Steuer 20 %', u.vat20)}
  ${u.kz006 ? row('006', 'zu versteuern mit 13 % – Bemessungsgrundlage', u.kz006) + row('', 'Steuer 13 %', u.vat13) : ''}
  ${u.kz029 ? row('029', 'zu versteuern mit 10 % – Bemessungsgrundlage', u.kz029) + row('', 'Steuer 10 %', u.vat10) : ''}
  ${u.kz057 ? row('057', 'Steuerschuld gemäß § 19 Abs 1 (Reverse Charge)', u.kz057) : ''}
  ${u.kz070 ? row('070', 'Innergemeinschaftliche Erwerbe – Bemessungsgrundlage', u.kz070) : ''}
  ${u.kz072 ? row('072', 'ig. Erwerb – Steuer 20 %', u.kz072) : ''}${u.kz073 ? row('073', 'ig. Erwerb – Steuer 10 %', u.kz073) : ''}${u.kz008 ? row('008', 'ig. Erwerb – Steuer 13 %', u.kz008) : ''}
  ${row('060', 'Gesamtbetrag der Vorsteuern', u.kz060)}
  ${u.kz065 ? row('065', 'Vorsteuern aus innergemeinschaftlichem Erwerb', u.kz065) : ''}
  ${u.kz066 ? row('066', 'Vorsteuern betreffend Reverse Charge (§ 19 Abs 1)', u.kz066) : ''}
  <tr class="sum"><td class="kz">095</td><td>${u.payable >= 0 ? 'Vorauszahlung (Zahllast)' : 'Überschuss (Gutschrift)'}</td><td class="num">${eur(Math.abs(u.payable))}</td></tr>
  </table>
  ${u.zmServices ? `<h2>Zusammenfassende Meldung</h2><p>Nicht steuerbare EU-Leistungen (Reverse Charge): ${eur(u.zmServices)} – in der ZM melden, nicht in der UVA.</p>` : ''}
  <p>Fällig am ${d(vatDueDate(period))}. Besteuerung: ${db.settings.taxationBasis === 'ist' ? 'Ist-Besteuerung (vereinnahmte Entgelte)' : 'Soll-Besteuerung (vereinbarte Entgelte)'}.</p>`;
  return page(`Umsatzsteuervoranmeldung ${period.label}`, db.settings, `${d(period.from)} – ${d(period.to)}`, body);
}

export function renderEarHtml(db: Database, year: number): string {
  const r = earReport(db, year);
  const est = estimateTaxes(r.profit, r.svsPaid, year, db.settings.svsInsured);
  const lines = (l: typeof r.income) => l.map((x) => row(x.e1a, x.label, x.amount)).join('');
  const body = `
  <h2>Betriebseinnahmen</h2><table>${lines(r.income)}<tr class="sum"><td></td><td>Summe Betriebseinnahmen</td><td class="num">${eur(r.totalIncome)}</td></tr></table>
  <h2>Betriebsausgaben</h2><table>${lines(r.expenses)}<tr class="sum"><td></td><td>Summe Betriebsausgaben</td><td class="num">${eur(r.totalExpenses)}</td></tr></table>
  <h2>Ergebnis</h2><table>
  ${row('', 'Gewinn/Verlust vor Gewinnfreibetrag', r.profit)}
  ${row('', 'Grundfreibetrag (15 % bis 33.000 €)', -r.basicAllowance)}
  <tr class="sum"><td></td><td>Steuerlicher Gewinn</td><td class="num">${eur(r.taxableProfit)}</td></tr></table>
  <h2>Kennzahlen Beilage E1a</h2><table>${e1aSummary(r).map((l) => row(l.e1a, l.label, l.amount)).join('')}</table>
  <h2>Schätzung Einkommensteuer und SVS</h2><table>
  ${row('', `Einkommensteuer (Tarif ${est.tariffYear}, ohne andere Einkünfte)`, est.incomeTax)}
  ${row('', 'SVS-Beiträge geschätzt (endgültig)', est.svs.total)}
  ${row('', 'SVS bereits bezahlt', r.svsPaid)}
  <tr class="sum"><td></td><td>Empfohlene Rücklage</td><td class="num">${eur(est.reserve)}</td></tr></table>
  ${r.warnings.length ? `<h2>Hinweise</h2><ul>${r.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>` : ''}`;
  return page(`Einnahmen-Ausgaben-Rechnung ${year}`, db.settings, `Wirtschaftsjahr ${year}`, body);
}

export function renderAssetsHtml(db: Database, year: number): string {
  const rows = db.assets
    .filter((a) => Number((a.inServiceDate || a.acquisitionDate).slice(0, 4)) <= year && (!a.disposalDate || Number(a.disposalDate.slice(0, 4)) >= year))
    .map((a) => {
      const sch = afaSchedule(a);
      const r = sch.find((x) => x.year === year);
      const before = sch.filter((x) => x.year < year).reduce((s, x) => s + x.afa + x.disposalLoss, 0);
      return `<tr><td>${escapeHtml(a.name)}</td><td>${d(a.acquisitionDate)}</td><td class="num">${eur(a.cost)}</td><td class="num">${a.lowValue ? 'GWG' : `${a.usefulLifeYears} J.`}</td>
        <td class="num">${eur(Math.round(a.cost * a.businessUsePercent / 100) - before)}</td><td class="num">${eur((r?.afa ?? 0) + (r?.disposalLoss ?? 0))}</td><td class="num">${eur(r?.bookValue ?? 0)}</td><td>${a.disposalDate ? d(a.disposalDate) : ''}</td></tr>`;
    })
    .join('');
  const body = `<table><tr><th>Wirtschaftsgut</th><th>Anschaffung</th><th class="num">AK</th><th class="num">ND</th><th class="num">Buchwert 1.1.</th><th class="num">AfA ${year}</th><th class="num">Buchwert 31.12.</th><th>Abgang</th></tr>${rows}</table>`;
  return page(`Anlagenverzeichnis ${year}`, db.settings, `Wirtschaftsjahr ${year}`, body);
}

export function renderTripsHtml(db: Database, year: number): string {
  const trips = db.trips.filter((t) => t.date.startsWith(String(year))).sort((a, b) => a.date.localeCompare(b.date));
  const km = kmAllowanceForYear(db.trips, year);
  const body = `<table><tr><th>Datum</th><th>Von</th><th>Nach</th><th>Zweck</th><th class="num">km</th><th class="num">€/km</th><th class="num">Betrag</th></tr>
  ${trips.map((t) => `<tr><td>${d(t.date)}</td><td>${escapeHtml(t.from)}</td><td>${escapeHtml(t.to)}</td><td>${escapeHtml(t.purpose)}</td><td class="num">${escapeHtml(String(t.km))}</td><td class="num">${eur(t.rate)}</td><td class="num">${eur(Math.round(t.km * t.rate))}</td></tr>`).join('')}
  <tr class="sum"><td colspan="4">Summe (max. 30.000 km)</td><td class="num">${km.km}</td><td></td><td class="num">${eur(km.amount)}</td></tr></table>`;
  return page(`Fahrtenbuch ${year}`, db.settings, `Kilometergeld lt. § 26 Z 4 EStG`, body);
}

export function renderCashBookHtml(db: Database, year: number): string {
  const acc = db.bankAccounts.find((a) => a.kind === 'cash');
  if (!acc) throw new Error('Keine Kassa angelegt.');
  let bal = accountBalance(db, acc.id, `${year - 1}-12-31`);
  const opening = bal;
  const txs = db.bankTransactions.filter((t) => t.accountId === acc.id && t.date.startsWith(String(year))).sort((a, b) => a.date.localeCompare(b.date));
  const rows = txs.map((t, i) => {
    bal += t.amount;
    return `<tr><td>${i + 1}</td><td>${d(t.date)}</td><td>${escapeHtml(t.reference)}</td><td>${escapeHtml(`${t.counterparty} ${t.purpose}`.trim())}</td><td class="num">${t.amount > 0 ? eur(t.amount) : ''}</td><td class="num">${t.amount < 0 ? eur(-t.amount) : ''}</td><td class="num">${eur(bal)}</td></tr>`;
  }).join('');
  const body = `<table><tr><th>Nr.</th><th>Datum</th><th>Beleg</th><th>Text</th><th class="num">Einnahme</th><th class="num">Ausgabe</th><th class="num">Stand</th></tr>
  <tr><td></td><td>${d(`${year}-01-01`)}</td><td></td><td>Anfangsbestand</td><td></td><td></td><td class="num">${eur(opening)}</td></tr>${rows}</table>`;
  return page(`Kassabuch ${year}`, db.settings, acc.name, body);
}
