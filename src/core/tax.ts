import { roundCents } from './money';
import type { BusinessDocument, Cents, CompanySettings, LineItem, TaxCase, VatRate } from './types';

export interface LineTotal {
  item: LineItem;
  net: Cents;
  /** Effektiv angewandter Steuersatz (0 bei Kleinunternehmer, Reverse Charge, ig. Lieferung) */
  vatRate: VatRate;
}

export interface VatGroup {
  rate: VatRate;
  net: Cents;
  vat: Cents;
}

export interface DocumentTotals {
  lines: LineTotal[];
  groups: VatGroup[];
  net: Cents;
  vat: Cents;
  gross: Cents;
  /** Grund, warum keine USt ausgewiesen wird (null = normale Besteuerung) */
  exemption: TaxExemption | null;
}

export type TaxExemption = 'small_business' | 'reverse_charge' | 'ig_delivery';

export function lineNet(item: LineItem): Cents {
  const discount = Math.min(Math.max(item.discountPercent || 0, 0), 100);
  return roundCents(item.quantity * item.unitPrice * (1 - discount / 100));
}

/**
 * Ermittelt, ob und warum ein Dokument ohne USt-Ausweis erstellt wird.
 * Reverse Charge und ig. Lieferung haben Vorrang, weil diese Hinweise auch
 * ein Kleinunternehmer (mit UID) auf der Rechnung anführen muss.
 */
export function exemptionFor(taxCase: TaxCase, settings: Pick<CompanySettings, 'isSmallBusiness'>): TaxExemption | null {
  if (taxCase === 'reverse_charge') return 'reverse_charge';
  if (taxCase === 'ig_delivery') return 'ig_delivery';
  if (settings.isSmallBusiness) return 'small_business';
  return null;
}

/**
 * Berechnet Netto, USt und Brutto. Die Steuer wird je Steuersatz auf die
 * Summe der Nettobeträge gerechnet (nicht je Position), wie in Österreich üblich.
 */
export function computeTotals(
  doc: Pick<BusinessDocument, 'items' | 'taxCase'>,
  settings: Pick<CompanySettings, 'isSmallBusiness'>,
): DocumentTotals {
  const exemption = exemptionFor(doc.taxCase, settings);
  const lines: LineTotal[] = doc.items.map((item) => ({
    item,
    net: lineNet(item),
    vatRate: exemption ? 0 : item.vatRate,
  }));

  const byRate = new Map<VatRate, Cents>();
  for (const l of lines) byRate.set(l.vatRate, (byRate.get(l.vatRate) ?? 0) + l.net);

  const groups: VatGroup[] = [...byRate.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([rate, net]) => ({ rate, net, vat: roundCents((net * rate) / 100) }));

  const net = groups.reduce((s, g) => s + g.net, 0);
  const vat = groups.reduce((s, g) => s + g.vat, 0);
  return { lines, groups, net, vat, gross: net + vat, exemption };
}

export function paidAmount(doc: Pick<BusinessDocument, 'payments'>): Cents {
  return doc.payments.reduce((s, p) => s + p.amount, 0);
}

export function openAmount(doc: BusinessDocument, settings: Pick<CompanySettings, 'isSmallBusiness'>): Cents {
  const fees = doc.dunning.reduce((s, d) => s + d.fee + d.interest, 0);
  return computeTotals(doc, settings).gross + fees - paidAmount(doc);
}
