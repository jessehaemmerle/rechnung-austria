/** Alle Geldbeträge werden als ganze Cent (integer) gespeichert. */
export type Cents = number;

export type Language = 'de' | 'en';
export type VatRate = 20 | 13 | 10 | 0;

/**
 * Steuerfall eines Dokuments.
 * - domestic: Inlandsumsatz (Regelbesteuerung oder Kleinunternehmer laut Einstellungen)
 * - reverse_charge: EU-B2B sonstige Leistung, Übergang der Steuerschuld (§ 3a Abs 6 / § 19 UStG, Art 196 MwSt-RL)
 * - ig_delivery: innergemeinschaftliche Lieferung, steuerfrei (Art 6 Abs 1 iVm Art 7 UStG-Binnenmarkt)
 */
export type TaxCase = 'domestic' | 'reverse_charge' | 'ig_delivery';

export type DocumentKind = 'offer' | 'invoice' | 'credit_note';
export type DocumentStatus = 'draft' | 'final' | 'cancelled';
export type OfferStatus = 'open' | 'accepted' | 'rejected' | 'invoiced';

export interface Address {
  street: string;
  zip: string;
  city: string;
  /** ISO 3166-1 alpha-2, z. B. "AT" */
  country: string;
}

export interface CompanySettings {
  name: string;
  owner: string;
  address: Address;
  email: string;
  phone: string;
  website: string;
  /** UID-Nummer, z. B. ATU12345678 (bei Kleinunternehmern optional) */
  vatId: string;
  /** Steuernummer beim Finanzamt */
  taxNumber: string;
  /** Firmenbuchnummer / Gericht, falls eingetragen */
  registerInfo: string;
  iban: string;
  bic: string;
  bankName: string;
  /** Data-URL eines Logos (PNG/JPG/SVG) */
  logo: string;
  isSmallBusiness: boolean;
  defaultPaymentTermDays: number;
  defaultOfferValidityDays: number;
  invoiceNumberPattern: string;
  offerNumberPattern: string;
  creditNoteNumberPattern: string;
  /** Basiszinssatz der OeNB in Prozent (für Verzugszinsen) */
  baseInterestRate: number;
  dunningFees: [Cents, Cents, Cents];
  dunningDays: [number, number, number];
  defaultLanguage: Language;
  footerNote: string;
}

export interface Customer {
  id: string;
  number: string;
  name: string;
  contactPerson: string;
  address: Address;
  email: string;
  vatId: string;
  /** true = Unternehmer (B2B), relevant für UGB-Verzugszinsen, Pauschale und UID-Pflicht */
  isBusiness: boolean;
  language: Language;
  /** Leitweg-ID / Auftragsreferenz für E-Rechnungen an öffentliche Auftraggeber */
  buyerReference: string;
  notes: string;
}

export interface Article {
  id: string;
  name: string;
  description: string;
  unit: string;
  unitPrice: Cents;
  vatRate: VatRate;
}

export interface LineItem {
  id: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: Cents;
  /** Rabatt in Prozent (0–100) */
  discountPercent: number;
  vatRate: VatRate;
}

export interface Payment {
  id: string;
  date: string;
  amount: Cents;
  note: string;
}

export interface DunningRecord {
  level: 1 | 2 | 3;
  date: string;
  fee: Cents;
  interest: Cents;
  dueDate: string;
}

export interface BusinessDocument {
  id: string;
  kind: DocumentKind;
  status: DocumentStatus;
  /** Leer, solange das Dokument ein Entwurf ist – die Nummer wird beim Finalisieren vergeben (lückenlos). */
  number: string;
  customerId: string;
  /** Snapshot der Kundendaten zum Zeitpunkt der Finalisierung (Unveränderbarkeit) */
  customerSnapshot?: Customer;
  /** Snapshot der Firmendaten zum Zeitpunkt der Finalisierung */
  companySnapshot?: CompanySettings;
  issueDate: string;
  /** Leistungsdatum oder Beginn des Leistungszeitraums */
  serviceDateFrom: string;
  /** Ende des Leistungszeitraums (optional) */
  serviceDateTo: string;
  dueDate: string;
  validUntil: string;
  taxCase: TaxCase;
  language: Language;
  title: string;
  introText: string;
  closingText: string;
  items: LineItem[];
  payments: Payment[];
  dunning: DunningRecord[];
  offerStatus?: OfferStatus;
  /** Referenz: Angebot → Rechnung, Storno → Originalrechnung */
  sourceDocumentId?: string;
  cancelledById?: string;
  createdAt: string;
  finalizedAt?: string;
}

export interface NumberCounters {
  /** Schlüssel: "<kind>:<jahr>" bzw. "<kind>" bei jahresunabhängigen Mustern */
  [key: string]: number;
}

export interface Database {
  version: 1;
  settings: CompanySettings;
  customers: Customer[];
  articles: Article[];
  documents: BusinessDocument[];
  counters: NumberCounters;
}
