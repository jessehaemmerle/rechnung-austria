import { formatDate, yearOf } from './dates';
import { centsToDecimal } from './money';
import { computeTotals, paidAmount } from './tax';
import type { BusinessDocument, Cents, CompanySettings, Customer, Database, VatRate } from './types';

export interface MonthRow {
  month: number;
  net: Cents;
  vat: Cents;
  gross: Cents;
  paid: Cents;
}

export interface YearReport {
  year: number;
  months: MonthRow[];
  byRate: { rate: VatRate; net: Cents; vat: Cents }[];
  reverseChargeNet: Cents;
  igDeliveryNet: Cents;
  smallBusinessNet: Cents;
  total: { net: Cents; vat: Cents; gross: Cents; paid: Cents; open: Cents };
}

const settingsOf = (db: Database, d: BusinessDocument): CompanySettings => d.companySnapshot ?? db.settings;

export function invoicesForYear(db: Database, year: number): BusinessDocument[] {
  return db.documents.filter((d) => d.kind !== 'offer' && d.status !== 'draft' && yearOf(d.issueDate) === year);
}

/** Umsatzübersicht nach Rechnungsdatum (Soll-Besteuerung) inkl. Stornos. */
export function yearReport(db: Database, year: number): YearReport {
  const months: MonthRow[] = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, net: 0, vat: 0, gross: 0, paid: 0 }));
  const rates = new Map<VatRate, { net: Cents; vat: Cents }>();
  let reverseChargeNet = 0;
  let igDeliveryNet = 0;
  let smallBusinessNet = 0;
  for (const d of invoicesForYear(db, year)) {
    const tot = computeTotals(d, settingsOf(db, d));
    const m = months[Number(d.issueDate.slice(5, 7)) - 1];
    m.net += tot.net;
    m.vat += tot.vat;
    m.gross += tot.gross;
    m.paid += paidAmount(d);
    if (tot.exemption === 'reverse_charge') reverseChargeNet += tot.net;
    else if (tot.exemption === 'ig_delivery') igDeliveryNet += tot.net;
    else if (tot.exemption === 'small_business') smallBusinessNet += tot.net;
    else
      for (const g of tot.groups) {
        const r = rates.get(g.rate) ?? { net: 0, vat: 0 };
        rates.set(g.rate, { net: r.net + g.net, vat: r.vat + g.vat });
      }
  }
  const sum = (k: keyof Omit<MonthRow, 'month'>) => months.reduce((s, m) => s + m[k], 0);
  const gross = sum('gross');
  const paid = sum('paid');
  return {
    year,
    months,
    byRate: [...rates.entries()].sort((a, b) => b[0] - a[0]).map(([rate, v]) => ({ rate, ...v })),
    reverseChargeNet,
    igDeliveryNet,
    smallBusinessNet,
    total: { net: sum('net'), vat: sum('vat'), gross, paid, open: gross - paid },
  };
}

function csvCell(v: string | number): string {
  const s = String(v);
  // Formel-Injection in Tabellenkalkulationen verhindern
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
  return /[;"\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const deDecimal = (c: Cents) => centsToDecimal(c).replace('.', ',');

/** CSV-Export (Semikolon-getrennt, deutsches Zahlenformat) für Steuerberater/Excel. */
export function invoicesCsv(db: Database, year: number): string {
  const head = [
    'Nummer', 'Art', 'Status', 'Rechnungsdatum', 'Leistungsdatum', 'Fällig', 'Kunde', 'UID Kunde', 'Land',
    'Steuerfall', 'Netto', 'USt 20%', 'USt 13%', 'USt 10%', 'USt gesamt', 'Brutto', 'Bezahlt', 'Offen', 'Bezahlt am',
  ];
  const lines = [head.join(';')];
  const sorted = [...invoicesForYear(db, year)].sort((a, b) => a.number.localeCompare(b.number));
  for (const d of sorted) {
    const tot = computeTotals(d, settingsOf(db, d));
    const c: Customer | undefined = d.customerSnapshot ?? db.customers.find((x) => x.id === d.customerId);
    const vatOf = (r: VatRate) => tot.groups.find((g) => g.rate === r)?.vat ?? 0;
    const paid = paidAmount(d);
    const caseLabel =
      tot.exemption === 'small_business' ? 'Kleinunternehmer' : tot.exemption === 'reverse_charge' ? 'Reverse Charge' : tot.exemption === 'ig_delivery' ? 'ig. Lieferung' : 'Inland';
    lines.push(
      [
        d.number, d.kind === 'credit_note' ? 'Storno' : 'Rechnung', d.status === 'cancelled' ? 'storniert' : 'final',
        formatDate(d.issueDate), formatDate(d.serviceDateFrom), formatDate(d.dueDate), c?.name ?? '', c?.vatId ?? '',
        c?.address.country ?? '', caseLabel, deDecimal(tot.net), deDecimal(vatOf(20)), deDecimal(vatOf(13)), deDecimal(vatOf(10)),
        deDecimal(tot.vat), deDecimal(tot.gross), deDecimal(paid), deDecimal(tot.gross - paid),
        d.payments.map((p) => formatDate(p.date)).join(', '),
      ]
        .map(csvCell)
        .join(';'),
    );
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}
