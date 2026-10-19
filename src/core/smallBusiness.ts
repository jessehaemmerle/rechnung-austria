import { yearOf } from './dates';
import { computeTotals } from './tax';
import type { BusinessDocument, Cents, CompanySettings } from './types';

/**
 * Kleinunternehmerregelung (§ 6 Abs 1 Z 27 UStG idF ab 1.1.2025):
 * - Umsatzgrenze 55.000 € (Bruttobetrag) im Vorjahr und im laufenden Jahr.
 * - Überschreitung im laufenden Jahr um nicht mehr als 10 % (bis 60.500 €) ist für
 *   dieses Jahr unschädlich; im Folgejahr ist die Befreiung aber nicht mehr anwendbar.
 * - Bei Überschreiten der 10 %-Toleranz entfällt die Befreiung ab dem Umsatz, mit dem
 *   die Toleranzgrenze überschritten wird.
 * Hinweis: Bestimmte Umsätze (z. B. Hilfsgeschäfte, bestimmte steuerfreie Umsätze)
 * bleiben bei der Grenze außer Ansatz – das bildet dieses Tool nicht ab.
 */
export const SMALL_BUSINESS_LIMIT: Cents = 5_500_000;
export const SMALL_BUSINESS_TOLERANCE_LIMIT: Cents = 6_050_000;

export type SmallBusinessStatus = 'ok' | 'approaching' | 'tolerance' | 'exceeded';

export interface SmallBusinessCheck {
  year: number;
  revenue: Cents;
  previousYearRevenue: Cents;
  status: SmallBusinessStatus;
  remaining: Cents;
  message: string;
}

/** Umsatz eines Jahres aus finalisierten Rechnungen und Stornos (nach Leistungsdatum). */
export function revenueForYear(docs: BusinessDocument[], settings: CompanySettings, year: number): Cents {
  return docs
    .filter((d) => d.kind !== 'offer' && d.status !== 'draft')
    .filter((d) => yearOf(d.serviceDateFrom || d.issueDate) === year)
    .reduce((s, d) => s + computeTotals(d, settings).gross, 0);
}

export function checkSmallBusiness(docs: BusinessDocument[], settings: CompanySettings, year: number): SmallBusinessCheck {
  const revenue = revenueForYear(docs, settings, year);
  const previousYearRevenue = revenueForYear(docs, settings, year - 1);
  const remaining = SMALL_BUSINESS_LIMIT - revenue;
  let status: SmallBusinessStatus = 'ok';
  let message = 'Umsatz liegt unter der Kleinunternehmergrenze.';

  if (revenue > SMALL_BUSINESS_TOLERANCE_LIMIT) {
    status = 'exceeded';
    message =
      'Toleranzgrenze von 60.500 € überschritten: Ab dem Umsatz, mit dem die Grenze überschritten wurde, ist Umsatzsteuer zu verrechnen. Bitte Regelbesteuerung aktivieren und Steuerberater kontaktieren.';
  } else if (revenue > SMALL_BUSINESS_LIMIT) {
    status = 'tolerance';
    message =
      'Grenze von 55.000 € überschritten, aber innerhalb der 10 %-Toleranz: Befreiung gilt für dieses Jahr noch, ab dem Folgejahr nicht mehr.';
  } else if (revenue > SMALL_BUSINESS_LIMIT * 0.8) {
    status = 'approaching';
    message = 'Über 80 % der Kleinunternehmergrenze erreicht.';
  }
  if (status === 'ok' && previousYearRevenue > SMALL_BUSINESS_LIMIT) {
    status = 'exceeded';
    message = 'Vorjahresumsatz über 55.000 €: Die Kleinunternehmerregelung ist in diesem Jahr nicht anwendbar.';
  }
  return { year, revenue, previousYearRevenue, status, remaining, message };
}

/** Würde diese Rechnung die Toleranzgrenze überschreiten? */
export function wouldExceedTolerance(
  docs: BusinessDocument[],
  doc: BusinessDocument,
  settings: CompanySettings,
): boolean {
  if (!settings.isSmallBusiness || doc.taxCase !== 'domestic') return false;
  const year = yearOf(doc.serviceDateFrom || doc.issueDate);
  const others = docs.filter((d) => d.id !== doc.id);
  return revenueForYear(others, settings, year) + computeTotals(doc, settings).gross > SMALL_BUSINESS_TOLERANCE_LIMIT;
}
