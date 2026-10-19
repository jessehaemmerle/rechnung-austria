import { checkInvoice, hasErrors } from './compliance';
import { addDays, todayIso } from './dates';
import { createDunning } from './dunning';
import { nextNumber } from './numbering';
import { computeTotals, paidAmount } from './tax';
import type {
  BusinessDocument,
  Cents,
  CompanySettings,
  Database,
  DocumentKind,
  LineItem,
  Payment,
} from './types';

export function newId(): string {
  return globalThis.crypto.randomUUID();
}

export function newLineItem(settings: CompanySettings): LineItem {
  return {
    id: newId(),
    description: '',
    quantity: 1,
    unit: 'Stk',
    unitPrice: 0,
    discountPercent: 0,
    vatRate: settings.isSmallBusiness ? 0 : 20,
  };
}

export function createDraft(db: Database, kind: 'offer' | 'invoice', customerId: string, today = todayIso()): BusinessDocument {
  const s = db.settings;
  const customer = db.customers.find((c) => c.id === customerId);
  return {
    id: newId(),
    kind,
    status: 'draft',
    number: '',
    customerId,
    issueDate: today,
    serviceDateFrom: kind === 'invoice' ? today : '',
    serviceDateTo: '',
    dueDate: kind === 'invoice' ? addDays(today, s.defaultPaymentTermDays) : '',
    validUntil: kind === 'offer' ? addDays(today, s.defaultOfferValidityDays) : '',
    taxCase: 'domestic',
    language: customer?.language ?? s.defaultLanguage,
    title: '',
    introText: '',
    closingText: '',
    items: [newLineItem(s)],
    payments: [],
    dunning: [],
    offerStatus: kind === 'offer' ? 'open' : undefined,
    createdAt: new Date().toISOString(),
  };
}

function patternFor(settings: CompanySettings, kind: DocumentKind): string {
  if (kind === 'offer') return settings.offerNumberPattern;
  if (kind === 'credit_note') return settings.creditNoteNumberPattern;
  return settings.invoiceNumberPattern;
}

function replaceDoc(db: Database, doc: BusinessDocument): Database {
  const exists = db.documents.some((d) => d.id === doc.id);
  return {
    ...db,
    documents: exists ? db.documents.map((d) => (d.id === doc.id ? doc : d)) : [...db.documents, doc],
  };
}

function getDoc(db: Database, id: string): BusinessDocument {
  const doc = db.documents.find((d) => d.id === id);
  if (!doc) throw new Error('Dokument nicht gefunden.');
  return doc;
}

/** Speichert einen Entwurf. Finalisierte Dokumente sind unveränderbar (§ 132 BAO). */
export function saveDraft(db: Database, doc: BusinessDocument): Database {
  const existing = db.documents.find((d) => d.id === doc.id);
  if (existing && existing.status !== 'draft') throw new Error('Finalisierte Dokumente können nicht mehr geändert werden.');
  return replaceDoc(db, { ...doc, status: 'draft', number: '' });
}

export function deleteDraft(db: Database, id: string): Database {
  const doc = getDoc(db, id);
  if (doc.status !== 'draft') throw new Error('Nur Entwürfe können gelöscht werden – finalisierte Rechnungen müssen storniert werden.');
  return { ...db, documents: db.documents.filter((d) => d.id !== id) };
}

/**
 * Finalisiert ein Dokument: Pflichtangaben prüfen, fortlaufende Nummer vergeben,
 * Firmen- und Kundendaten einfrieren.
 */
export function finalizeDocument(db: Database, id: string): { db: Database; doc: BusinessDocument } {
  const doc = getDoc(db, id);
  if (doc.status !== 'draft') throw new Error('Dokument ist bereits finalisiert.');
  const customer = db.customers.find((c) => c.id === doc.customerId);
  const issues = checkInvoice(doc, db.settings, customer);
  if (hasErrors(issues)) {
    throw new Error(issues.filter((i) => i.level === 'error').map((i) => i.message).join('\n'));
  }
  const { number, counters } = nextNumber(db.counters, doc.kind, patternFor(db.settings, doc.kind), doc.issueDate);
  const final: BusinessDocument = {
    ...doc,
    status: 'final',
    number,
    customerSnapshot: customer ? structuredClone(customer) : undefined,
    companySnapshot: structuredClone(db.settings),
    finalizedAt: new Date().toISOString(),
  };
  return { db: { ...replaceDoc(db, final), counters }, doc: final };
}

/** Erstellt aus einem Angebot einen Rechnungsentwurf. */
export function convertOfferToInvoice(db: Database, offerId: string, today = todayIso()): { db: Database; doc: BusinessDocument } {
  const offer = getDoc(db, offerId);
  if (offer.kind !== 'offer') throw new Error('Nur Angebote können in Rechnungen umgewandelt werden.');
  const draft = createDraft(db, 'invoice', offer.customerId, today);
  const invoice: BusinessDocument = {
    ...draft,
    taxCase: offer.taxCase,
    language: offer.language,
    title: offer.title,
    introText: '',
    closingText: '',
    items: offer.items.map((i) => ({ ...i, id: newId() })),
    sourceDocumentId: offer.id,
  };
  const updatedOffer: BusinessDocument = { ...offer, offerStatus: 'invoiced' };
  return { db: replaceDoc(replaceDoc(db, updatedOffer), invoice), doc: invoice };
}

/**
 * Storniert eine finalisierte Rechnung durch eine Stornorechnung (Gutschrift mit
 * negativen Mengen), die sofort finalisiert wird. Die Originalrechnung bleibt erhalten.
 */
export function cancelInvoice(db: Database, invoiceId: string, today = todayIso()): { db: Database; doc: BusinessDocument } {
  const inv = getDoc(db, invoiceId);
  if (inv.kind !== 'invoice' || inv.status !== 'final') throw new Error('Nur finalisierte Rechnungen können storniert werden.');
  if (inv.cancelledById) throw new Error('Rechnung wurde bereits storniert.');
  const settings = inv.companySnapshot ?? db.settings;
  const credit: BusinessDocument = {
    ...inv,
    id: newId(),
    kind: 'credit_note',
    status: 'draft',
    number: '',
    issueDate: today,
    dueDate: today,
    title: inv.language === 'de' ? `Storno zu Rechnung ${inv.number}` : `Cancellation of invoice ${inv.number}`,
    introText: '',
    closingText: '',
    items: inv.items.map((i) => ({ ...i, id: newId(), quantity: -i.quantity })),
    payments: [],
    dunning: [],
    sourceDocumentId: inv.id,
    cancelledById: undefined,
    customerSnapshot: undefined,
    companySnapshot: undefined,
    finalizedAt: undefined,
    createdAt: new Date().toISOString(),
  };
  // Der Steuerstatus (Kleinunternehmer ja/nein) der Originalrechnung muss erhalten bleiben.
  const tmp = { ...db, settings: { ...db.settings, isSmallBusiness: settings.isSmallBusiness } };
  const res = finalizeDocument(replaceDoc(tmp, credit), credit.id);
  const finalDb = { ...res.db, settings: db.settings };
  return { db: replaceDoc(finalDb, { ...inv, status: 'cancelled', cancelledById: res.doc.id }), doc: res.doc };
}

/** Steuer-relevante Einstellungen eines Dokuments (eingefroren bei Finalisierung). */
export function settingsFor(db: Database, doc: BusinessDocument): CompanySettings {
  return doc.companySnapshot ?? db.settings;
}

export function addPayment(db: Database, docId: string, payment: Omit<Payment, 'id'>): Database {
  const doc = getDoc(db, docId);
  if (doc.status !== 'final' || doc.kind !== 'invoice') throw new Error('Zahlungen können nur zu finalisierten Rechnungen erfasst werden.');
  if (!(payment.amount > 0)) throw new Error('Betrag muss größer als 0 sein.');
  return replaceDoc(db, { ...doc, payments: [...doc.payments, { ...payment, id: newId() }] });
}

export function removePayment(db: Database, docId: string, paymentId: string): Database {
  const doc = getDoc(db, docId);
  return replaceDoc(db, { ...doc, payments: doc.payments.filter((p) => p.id !== paymentId) });
}

export function addDunning(
  db: Database,
  docId: string,
  options: { chargeInterest: boolean; applyCollectionFee: boolean },
  today = todayIso(),
): Database {
  const doc = getDoc(db, docId);
  const customer = doc.customerSnapshot ?? db.customers.find((c) => c.id === doc.customerId);
  const settings = { ...db.settings, isSmallBusiness: settingsFor(db, doc).isSmallBusiness };
  const record = createDunning(doc, settings, customer, today, options);
  return replaceDoc(db, { ...doc, dunning: [...doc.dunning, record] });
}

export type PaymentState = 'draft' | 'open' | 'partial' | 'paid' | 'overdue' | 'cancelled';

export function paymentState(db: Database, doc: BusinessDocument, today = todayIso()): PaymentState {
  if (doc.status === 'draft') return 'draft';
  if (doc.status === 'cancelled') return 'cancelled';
  if (doc.kind !== 'invoice') return 'paid';
  const gross: Cents = computeTotals(doc, settingsFor(db, doc)).gross;
  const paid = paidAmount(doc);
  if (paid >= gross) return 'paid';
  if (doc.dueDate && doc.dueDate < today) return 'overdue';
  return paid > 0 ? 'partial' : 'open';
}
