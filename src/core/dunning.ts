import { addDays, daysBetween } from './dates';
import { roundCents } from './money';
import { computeTotals, paidAmount } from './tax';
import type { BusinessDocument, Cents, CompanySettings, Customer, DunningRecord } from './types';

/** Gesetzliche Zinsen bei Verbrauchergeschäften (§ 1000 Abs 1 ABGB). */
export const CONSUMER_INTEREST_RATE = 4;
/** Aufschlag auf den Basiszinssatz bei unternehmerischen Geschäften (§ 456 UGB). */
export const B2B_INTEREST_MARKUP = 9.2;
/** Pauschale Betreibungskosten bei B2B (§ 458 UGB). */
export const B2B_COLLECTION_FEE: Cents = 4_000;

export function interestRate(customer: Pick<Customer, 'isBusiness'> | undefined, baseRate: number): number {
  return customer?.isBusiness ? baseRate + B2B_INTEREST_MARKUP : CONSUMER_INTEREST_RATE;
}

/** Verzugszinsen (taggenau, Basis 365 Tage) auf den offenen Rechnungsbetrag. */
export function computeInterest(principal: Cents, ratePercent: number, fromIso: string, toIso: string): Cents {
  const days = Math.max(0, daysBetween(fromIso, toIso));
  return roundCents((principal * ratePercent * days) / 100 / 365);
}

/**
 * Verzugszinsen auf den jeweils offenen Betrag: Teilzahlungen verringern die
 * Zinsbasis ab dem Zahlungstag.
 */
export function interestWithPayments(gross: Cents, payments: { date: string; amount: Cents }[], ratePercent: number, dueIso: string, toIso: string): Cents {
  let open = gross;
  let from = dueIso;
  let total = 0;
  for (const p of [...payments].sort((a, b) => a.date.localeCompare(b.date))) {
    if (p.date >= toIso) break;
    if (p.date > from) {
      total += computeInterest(Math.max(0, open), ratePercent, from, p.date);
      from = p.date;
    }
    open -= p.amount;
  }
  return total + computeInterest(Math.max(0, open), ratePercent, from, toIso);
}

export function isOverdue(doc: BusinessDocument, settings: CompanySettings, today: string): boolean {
  return (
    doc.kind === 'invoice' &&
    doc.status === 'final' &&
    !!doc.dueDate &&
    doc.dueDate < today &&
    paidAmount(doc) < computeTotals(doc, settings).gross
  );
}

export function nextDunningLevel(doc: BusinessDocument): 1 | 2 | 3 | null {
  const n = doc.dunning.length;
  return n >= 3 ? null : ((n + 1) as 1 | 2 | 3);
}

/**
 * Erstellt die nächste Mahnstufe. Stufe 1 = Zahlungserinnerung (ohne Gebühr laut Default),
 * Stufe 2/3 = Mahnung mit Gebühr und Verzugszinsen. Bei B2B wird mit der ersten
 * kostenpflichtigen Mahnung einmalig die Pauschale nach § 458 UGB verrechnet, wenn
 * `applyCollectionFee` gesetzt ist.
 */
export function createDunning(
  doc: BusinessDocument,
  settings: CompanySettings,
  customer: Customer | undefined,
  today: string,
  options: { chargeInterest: boolean; applyCollectionFee: boolean },
): DunningRecord {
  const level = nextDunningLevel(doc);
  if (!level) throw new Error('Es wurden bereits alle drei Mahnstufen erstellt.');
  if (!isOverdue(doc, settings, today)) throw new Error('Rechnung ist nicht überfällig.');

  const gross = computeTotals(doc, settings).gross;
  const alreadyCharged = doc.dunning.reduce((s, d) => s + d.interest, 0);
  const interest =
    options.chargeInterest && level > 1
      ? Math.max(0, interestWithPayments(gross, doc.payments, interestRate(customer, settings.baseInterestRate), doc.dueDate, today) - alreadyCharged)
      : 0;

  let fee = settings.dunningFees[level - 1] ?? 0;
  // Die Pauschale nach § 458 UGB wird einmalig zusätzlich zu den Mahnspesen verrechnet.
  const collectionFee = !!customer?.isBusiness && options.applyCollectionFee && level > 1 && !doc.dunning.some((d) => d.collectionFee);
  if (collectionFee) fee += B2B_COLLECTION_FEE;
  return { level, date: today, fee, interest, dueDate: addDays(today, settings.dunningDays[level - 1] ?? 14), collectionFee };
}
