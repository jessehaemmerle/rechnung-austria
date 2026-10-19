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
