import { roundCents } from '../money';
import { computeTotals, paidAmount } from '../tax';
import type { BusinessDocument, Cents, CompanySettings, Database } from '../types';
import { entryAmounts } from './entries';

export interface VatPeriod {
  year: number;
  /** 1–12 bei monatlicher, 1–4 bei vierteljährlicher Abgabe */
  index: number;
  kind: 'monthly' | 'quarterly';
  from: string;
  to: string;
  label: string;
}

const MONTHS = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

export function periodsOfYear(year: number, kind: 'monthly' | 'quarterly'): VatPeriod[] {
  const n = kind === 'monthly' ? 12 : 4;
  return Array.from({ length: n }, (_, i) => {
    const m1 = kind === 'monthly' ? i + 1 : i * 3 + 1;
    const m2 = kind === 'monthly' ? i + 1 : i * 3 + 3;
    const last = new Date(Date.UTC(year, m2, 0)).getUTCDate();
    return {
      year,
      index: i + 1,
      kind,
      from: `${year}-${String(m1).padStart(2, '0')}-01`,
      to: `${year}-${String(m2).padStart(2, '0')}-${last}`,
      label: kind === 'monthly' ? `${MONTHS[i]} ${year}` : `${i + 1}. Quartal ${year}`,
    };
  });
}

/** Fälligkeit der UVA: 15. des zweitfolgenden Monats nach Ende des Zeitraums */
export function vatDueDate(p: VatPeriod): string {
  const d = new Date(Date.UTC(Number(p.to.slice(0, 4)), Number(p.to.slice(5, 7)) + 1, 15));
  return d.toISOString().slice(0, 10);
}

/** Kennzahlen des Formulars U30 (Umsatzsteuervoranmeldung) */
export interface UvaResult {
  period: VatPeriod;
  kz000: Cents; // Gesamtbetrag der Bemessungsgrundlagen
  kz016: Cents; // steuerfrei ohne Vorsteuerabzug (Kleinunternehmer)
  kz017: Cents; // innergemeinschaftliche Lieferungen
  kz022: Cents; // Bemessungsgrundlage 20 %
  kz029: Cents; // Bemessungsgrundlage 10 %
  kz006: Cents; // Bemessungsgrundlage 13 %
  vat20: Cents;
  vat10: Cents;
  vat13: Cents;
  kz057: Cents; // Steuerschuld Reverse Charge (§ 19 Abs 1 UStG)
  kz070: Cents; // ig. Erwerbe Bemessungsgrundlage
  kz072: Cents; // ig. Erwerb – Steuer 20 %
  kz073: Cents; // ig. Erwerb – Steuer 10 %
  kz008: Cents; // ig. Erwerb – Steuer 13 %
  kz060: Cents; // Vorsteuern (ohne ig. Erwerb und Reverse Charge)
  kz065: Cents; // Vorsteuern aus ig. Erwerb
  kz066: Cents; // Vorsteuern aus Reverse Charge
  /** Nicht steuerbare EU-Leistungen (nur Zusammenfassende Meldung) */
  zmServices: Cents;
  /** positiv = Zahllast, negativ = Gutschrift */
  payable: Cents;
}

const inPeriod = (d: string, p: VatPeriod) => !!d && d >= p.from && d <= p.to;
const settingsOf = (db: Database, d: BusinessDocument): CompanySettings => d.companySnapshot ?? db.settings;

/**
 * Monat, in dem bei Soll-Besteuerung die Steuerschuld entsteht (§ 19 Abs 2 UStG):
 * Ablauf des Monats der Leistung; wird die Rechnung später ausgestellt, verschiebt
 * sich der Zeitpunkt um höchstens einen Monat.
 */
export function accrualDate(doc: BusinessDocument): string {
  const service = (doc.serviceDateTo || doc.serviceDateFrom || doc.issueDate).slice(0, 7);
  const issue = doc.issueDate.slice(0, 7);
  if (issue <= service) return `${service}-01`;
  const [y, m] = service.split('-').map(Number);
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
  return `${issue < next ? issue : next}-01`;
}

/** Umsätze aus Ausgangsrechnungen als Liste (Datum, Steuersatz, Netto, Steuer, Fall) */
function salesEvents(db: Database) {
  const ist = db.settings.taxationBasis === 'ist';
  const out: { date: string; rate: number; net: Cents; vat: Cents; exemption: string | null }[] = [];
  for (const d of db.documents) {
    if (d.kind === 'offer' || d.status === 'draft') continue;
    const s = settingsOf(db, d);
    const totals = computeTotals(d, s);
    const push = (date: string, factor: number) => {
      for (const g of totals.groups) out.push({ date, rate: g.rate, net: roundCents(g.net * factor), vat: roundCents(g.vat * factor), exemption: totals.exemption });
    };
    if (!ist) {
      push(d.kind === 'credit_note' ? d.issueDate : accrualDate(d), 1);
    } else if (d.kind === 'invoice') {
      for (const p of d.payments) push(p.date, totals.gross ? p.amount / totals.gross : 0);
    } else {
      // Ist-Besteuerung: Storno mindert die Steuer nur im Umfang bereits bezahlter Beträge.
      const src = db.documents.find((x) => x.id === d.sourceDocumentId);
      if (src) {
        const srcGross = computeTotals(src, settingsOf(db, src)).gross;
        const paidShare = srcGross ? Math.min(1, paidAmount(src) / srcGross) : 0;
        if (paidShare > 0) push(d.issueDate, paidShare);
      }
    }
  }
  for (const e of db.entries) {
    if (e.kind !== 'income') continue;
    const date = ist ? e.paidDate : e.date;
    const a = entryAmounts(e, db.settings);
    out.push({ date, rate: db.settings.isSmallBusiness ? 0 : e.vatRate, net: a.net, vat: a.vat, exemption: db.settings.isSmallBusiness ? 'small_business' : null });
  }
  return out;
}

export function computeUva(db: Database, period: VatPeriod): UvaResult {
  const r: UvaResult = {
    period, kz000: 0, kz016: 0, kz017: 0, kz022: 0, kz029: 0, kz006: 0, vat20: 0, vat10: 0, vat13: 0,
    kz057: 0, kz070: 0, kz072: 0, kz073: 0, kz008: 0, kz060: 0, kz065: 0, kz066: 0, zmServices: 0, payable: 0,
  };
  for (const ev of salesEvents(db)) {
    if (!inPeriod(ev.date, period)) continue;
    if (ev.exemption === 'reverse_charge') {
      r.zmServices += ev.net;
      continue;
    }
    r.kz000 += ev.net;
    if (ev.exemption === 'ig_delivery') r.kz017 += ev.net;
    else if (ev.exemption === 'small_business') r.kz016 += ev.net;
    else if (ev.rate === 20) { r.kz022 += ev.net; r.vat20 += ev.vat; }
    else if (ev.rate === 10) { r.kz029 += ev.net; r.vat10 += ev.vat; }
    else if (ev.rate === 13) { r.kz006 += ev.net; r.vat13 += ev.vat; }
  }

  const ist = db.settings.taxationBasis === 'ist';
  for (const e of db.entries) {
    if (e.kind !== 'expense') continue;
    const a = entryAmounts(e, db.settings);
    if (e.taxCase === 'reverse_charge' || e.taxCase === 'ig_acquisition') {
      // Steuerschuld und Vorsteuer entstehen mit Rechnungsdatum, unabhängig von der Zahlung.
      if (!inPeriod(e.date, period)) continue;
      if (e.taxCase === 'reverse_charge') {
        r.kz057 += a.vat;
        r.kz066 += a.inputTax;
      } else {
        r.kz070 += a.net;
        if (e.vatRate === 20) r.kz072 += a.vat;
        else if (e.vatRate === 10) r.kz073 += a.vat;
        else if (e.vatRate === 13) r.kz008 += a.vat;
        r.kz065 += a.inputTax;
      }
      continue;
    }
    // Ist-Versteuerer dürfen die Vorsteuer erst nach Bezahlung abziehen (§ 12 Abs 1 Z 1 lit a UStG).
    const date = ist ? e.paidDate : e.date;
    if (inPeriod(date, period)) r.kz060 += a.inputTax;
  }
  const tax = r.vat20 + r.vat10 + r.vat13 + r.kz057 + r.kz072 + r.kz073 + r.kz008;
  r.payable = tax - r.kz060 - r.kz065 - r.kz066;
  return r;
}
