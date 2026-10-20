import { roundCents } from '../money';
import { computeTotals } from '../tax';
import type { BusinessDocument, Cents, CompanySettings, Database, Entry, VatRate } from '../types';
import { categoryById } from './categories';

export interface EntryAmounts {
  net: Cents;
  /** Im Beleg ausgewiesene bzw. geschuldete Steuer */
  vat: Cents;
  /** Abziehbare Vorsteuer (0 bei Kleinunternehmer oder ohne Abzugsberechtigung) */
  inputTax: Cents;
  /** Ertragsteuerlich wirksamer Betrag (netto bzw. brutto ohne Vorsteuerabzug, × absetzbarer Anteil) */
  incomeTaxAmount: Cents;
}

/**
 * Zerlegt einen Beleg in Netto, Steuer und Vorsteuer.
 * - Inland: Bruttobetrag enthält die USt.
 * - Reverse Charge / ig. Erwerb: Beleg ist netto, die Steuer wird selbst berechnet
 *   und gleichzeitig als Vorsteuer abgezogen (bei voller Abzugsberechtigung neutral).
 * - Kleinunternehmer haben keinen Vorsteuerabzug; Ausgaben zählen brutto.
 */
export function entryAmounts(e: Entry, settings: Pick<CompanySettings, 'isSmallBusiness'>): EntryAmounts {
  const share = categoryById(e.category).deductibleShare;
  if (e.kind === 'income') {
    const vat = e.taxCase === 'domestic' && !settings.isSmallBusiness ? roundCents((e.gross * e.vatRate) / (100 + e.vatRate)) : 0;
    return { net: e.gross - vat, vat, inputTax: 0, incomeTaxAmount: e.gross - vat };
  }
  let net: Cents;
  let vat: Cents;
  if (e.taxCase === 'domestic') {
    vat = roundCents((e.gross * e.vatRate) / (100 + e.vatRate));
    net = e.gross - vat;
  } else if (e.taxCase === 'reverse_charge' || e.taxCase === 'ig_acquisition') {
    net = e.gross;
    vat = roundCents((e.gross * e.vatRate) / 100);
  } else {
    net = e.gross;
    vat = 0;
  }
  const deductible = !settings.isSmallBusiness && e.inputTaxDeductible;
  const inputTax = deductible ? vat : 0;
  // Ohne Vorsteuerabzug gehört die (im Inland bezahlte) USt zu den Kosten.
  const cost = deductible ? net : e.taxCase === 'domestic' ? e.gross : net + (e.taxCase === 'none' ? 0 : vat);
  return { net, vat, inputTax, incomeTaxAmount: roundCents(cost * share) };
}

/** Netto-/Steueranteil eines Zahlungseingangs auf eine Ausgangsrechnung, aufgeteilt nach Steuersätzen. */
export function splitPayment(doc: BusinessDocument, settings: CompanySettings, amount: Cents) {
  const totals = computeTotals(doc, settings);
  if (totals.gross === 0) return [] as { rate: VatRate; net: Cents; vat: Cents }[];
  const factor = amount / totals.gross;
  return totals.groups.map((g) => ({ rate: g.rate, net: roundCents(g.net * factor), vat: roundCents(g.vat * factor) }));
}

export function emptyEntry(kind: 'expense' | 'income', today: string, settings: CompanySettings): Entry {
  const category = kind === 'expense' ? 'other_expense' : 'revenue_other';
  return {
    id: '',
    kind,
    date: today,
    paidDate: today,
    paidVia: 'bank',
    description: '',
    counterparty: '',
    receiptNumber: '',
    category,
    gross: 0,
    vatRate: settings.isSmallBusiness && kind === 'income' ? 0 : 20,
    taxCase: 'domestic',
    inputTaxDeductible: !settings.isSmallBusiness && categoryById(category).inputTaxDefault,
    receipts: [],
    notes: '',
    createdAt: new Date().toISOString(),
  };
}

/** Offene (noch nicht bezahlte) Ausgaben */
export function unpaidEntries(db: Database): Entry[] {
  return db.entries.filter((e) => e.kind === 'expense' && !e.paidDate);
}
