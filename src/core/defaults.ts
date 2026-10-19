import type { CompanySettings, Database } from './types';

export const DEFAULT_SETTINGS: CompanySettings = {
  name: '',
  owner: '',
  address: { street: '', zip: '', city: '', country: 'AT' },
  email: '',
  phone: '',
  website: '',
  vatId: '',
  taxNumber: '',
  registerInfo: '',
  iban: '',
  bic: '',
  bankName: '',
  logo: '',
  isSmallBusiness: true,
  defaultPaymentTermDays: 14,
  defaultOfferValidityDays: 30,
  invoiceNumberPattern: 'RE-{JJJJ}-{NNNN}',
  offerNumberPattern: 'AN-{JJJJ}-{NNNN}',
  creditNoteNumberPattern: 'ST-{JJJJ}-{NNNN}',
  // Basiszinssatz der OeNB – bitte regelmäßig aktualisieren (oenb.at).
  baseInterestRate: 1.53,
  dunningFees: [0, 1000, 1500],
  dunningDays: [7, 10, 10],
  defaultLanguage: 'de',
  footerNote: '',
};

export function emptyDatabase(): Database {
  return {
    version: 1,
    settings: structuredClone(DEFAULT_SETTINGS),
    customers: [],
    articles: [],
    documents: [],
    counters: {},
  };
}

/** Ergänzt fehlende Felder (z. B. nach Updates) mit Defaults. */
export function migrateDatabase(raw: unknown): Database {
  const db = (raw ?? {}) as Partial<Database>;
  const base = emptyDatabase();
  return {
    version: 1,
    settings: { ...base.settings, ...(db.settings ?? {}), address: { ...base.settings.address, ...(db.settings?.address ?? {}) } },
    customers: db.customers ?? [],
    articles: db.articles ?? [],
    documents: db.documents ?? [],
    counters: db.counters ?? {},
  };
}

const ISO_DATE = /^(\d{4}-\d{2}-\d{2})?$/;
const RATES = new Set([20, 13, 10, 0]);

/**
 * Strikte Typprüfung importierter Daten (z. B. Sicherungsdateien aus fremder Quelle),
 * damit keine manipulierten Werte in Berechnung, Nummernkreis oder Druckvorlage gelangen.
 */
export function validateDatabase(db: Database): Database {
  const fail = (where: string) => {
    throw new Error(`Ungültige Daten in der Sicherung: ${where}`);
  };
  const str = (v: unknown, where: string) => typeof v === 'string' || fail(where);
  const int = (v: unknown, where: string) => Number.isSafeInteger(v) || fail(where);
  const date = (v: unknown, where: string) => (typeof v === 'string' && ISO_DATE.test(v)) || fail(where);

  str(db.settings.name, 'Firmenname');
  if (db.settings.logo && !/^data:image\/(png|jpe?g|svg\+xml|webp);base64,[A-Za-z0-9+/=]+$/.test(db.settings.logo)) fail('Logo');
  for (const c of db.customers) {
    str(c.id, 'Kunden-ID');
    str(c.name, `Kunde ${c.id}`);
    str(c.address?.country, `Land Kunde ${c.id}`);
  }
  for (const a of db.articles) int(a.unitPrice, `Preis ${a.name}`);
  for (const d of db.documents) {
    const w = `Dokument ${d.number || d.id}`;
    if (!['offer', 'invoice', 'credit_note'].includes(d.kind) || !['draft', 'final', 'cancelled'].includes(d.status)) fail(w);
    if (!['domestic', 'reverse_charge', 'ig_delivery'].includes(d.taxCase) || !['de', 'en'].includes(d.language)) fail(w);
    for (const k of ['issueDate', 'serviceDateFrom', 'serviceDateTo', 'dueDate', 'validUntil'] as const) date(d[k] ?? '', `${w}: ${k}`);
    if (!Array.isArray(d.items) || !Array.isArray(d.payments) || !Array.isArray(d.dunning)) fail(w);
    for (const i of d.items) {
      if (!Number.isFinite(i.quantity) || !Number.isFinite(i.discountPercent) || !RATES.has(i.vatRate)) fail(`${w}: Position`);
      int(i.unitPrice, `${w}: Preis`);
      str(i.description, `${w}: Bezeichnung`);
      str(i.unit, `${w}: Einheit`);
    }
    for (const p of d.payments) { int(p.amount, `${w}: Zahlung`); date(p.date, `${w}: Zahlungsdatum`); }
    for (const r of d.dunning) { int(r.fee, `${w}: Mahnung`); int(r.interest, `${w}: Mahnung`); date(r.date, w); date(r.dueDate, w); }
  }
  for (const v of Object.values(db.counters)) int(v, 'Nummernkreis');
  return db;
}
