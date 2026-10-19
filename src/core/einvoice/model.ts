import { centsToDecimal } from '../money';
import { computeTotals, paidAmount } from '../tax';
import type { BusinessDocument, Cents, CompanySettings, Customer, VatRate } from '../types';

/** EN 16931 / UNTDID 5305 Steuerkategorien */
export type TaxCategory = 'S' | 'E' | 'AE' | 'K';

export interface EModelLine {
  position: number;
  description: string;
  quantity: number;
  unitCode: string;
  unitPrice: Cents;
  discountPercent: number;
  /** Rabattbetrag (positiv) */
  discount: Cents;
  net: Cents;
  rate: VatRate;
  category: TaxCategory;
}

export interface EModelTaxGroup {
  rate: VatRate;
  category: TaxCategory;
  net: Cents;
  vat: Cents;
}

/** Beträge sind vorzeichenbehaftet: Stornorechnungen haben negative Mengen und Summen. */
export interface EModel {
  doc: BusinessDocument;
  seller: CompanySettings;
  buyer: Customer;
  isCredit: boolean;
  lines: EModelLine[];
  groups: EModelTaxGroup[];
  net: Cents;
  vat: Cents;
  gross: Cents;
  prepaid: Cents;
  payable: Cents;
  exemptionReason: string;
  exemptionCode: string;
  sourceNumber: string;
  sourceDate: string;
}

/** UN/ECE Rec. 20 Codes für gängige Einheiten */
export function unitCode(unit: string): string {
  const u = unit.trim().toLowerCase().replace(/\.$/, '');
  const map: Record<string, string> = {
    stk: 'H87', stück: 'H87', pcs: 'H87', piece: 'H87', h: 'HUR', std: 'HUR', stunde: 'HUR', stunden: 'HUR', hour: 'HUR', hours: 'HUR',
    tag: 'DAY', tage: 'DAY', day: 'DAY', days: 'DAY', monat: 'MON', month: 'MON', km: 'KMT', kg: 'KGM', m: 'MTR', m2: 'MTK', 'm²': 'MTK',
    l: 'LTR', pauschal: 'LS', psch: 'LS', pausch: 'LS', 'lump sum': 'LS', min: 'MIN', minute: 'MIN', woche: 'WEE', week: 'WEE',
  };
  return map[u] ?? 'C62';
}

export function buildModel(doc: BusinessDocument, seller: CompanySettings, buyer: Customer, source?: BusinessDocument): EModel {
  if (doc.kind === 'offer') throw new Error('Für Angebote wird keine E-Rechnung erzeugt.');
  if (doc.status === 'draft') throw new Error('E-Rechnungen können nur aus finalisierten Rechnungen erzeugt werden.');
  const isCredit = doc.kind === 'credit_note';
  const totals = computeTotals(doc, seller);
  const category: TaxCategory | null =
    totals.exemption === 'small_business' ? 'E' : totals.exemption === 'reverse_charge' ? 'AE' : totals.exemption === 'ig_delivery' ? 'K' : null;

  const lines: EModelLine[] = totals.lines.map((l, i) => {
    const quantity = l.item.quantity;
    const gross = Math.round(quantity * l.item.unitPrice);
    const net = l.net;
    return {
      position: i + 1,
      description: l.item.description,
      quantity,
      unitCode: unitCode(l.item.unit),
      unitPrice: l.item.unitPrice,
      discountPercent: l.item.discountPercent || 0,
      discount: gross - net,
      net,
      rate: l.vatRate,
      category: category ?? (l.vatRate === 0 ? 'E' : 'S'),
    };
  });
  const groups = totals.groups.map((g) => ({
    rate: g.rate,
    category: category ?? (g.rate === 0 ? ('E' as const) : ('S' as const)),
    net: g.net,
    vat: g.vat,
  }));
  const prepaid = paidAmount(doc);
  const reasons: Record<TaxCategory, [string, string]> = {
    E: ['Umsatzsteuerbefreit – Kleinunternehmer gemäß § 6 Abs. 1 Z 27 UStG', 'VATEX-EU-O'],
    AE: ['Reverse Charge – Übergang der Steuerschuld auf den Leistungsempfänger', 'VATEX-EU-AE'],
    K: ['Steuerfreie innergemeinschaftliche Lieferung', 'VATEX-EU-IC'],
    S: ['', ''],
  };
  const [exemptionReason, exemptionCode] = category ? reasons[category] : ['', ''];
  return {
    doc,
    seller,
    buyer,
    isCredit,
    lines,
    groups,
    net: totals.net,
    vat: totals.vat,
    gross: totals.gross,
    prepaid,
    payable: totals.gross - prepaid,
    // Kleinunternehmer ohne UST verwenden in EN 16931 "E" mit Befreiungsgrund
    exemptionReason: category === 'E' ? reasons.E[0] : exemptionReason,
    exemptionCode: category === 'E' ? '' : exemptionCode,
    sourceNumber: source?.number ?? '',
    sourceDate: source?.issueDate ?? '',
  };
}

export function xml(s: string | number): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // In XML 1.0 unzulässige Steuerzeichen entfernen
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

export const amt = (c: Cents) => centsToDecimal(c);
export const qty = (n: number) => (Math.round(n * 10000) / 10000).toFixed(4);
export const pct = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
