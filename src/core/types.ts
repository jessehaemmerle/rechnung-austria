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
  /** Buchhaltung */
  vatPeriod: 'monthly' | 'quarterly';
  /** Ist-Besteuerung (nach Zahlung) oder Soll-Besteuerung (nach Rechnungsdatum) */
  taxationBasis: 'ist' | 'soll';
  /** Amtliches Kilometergeld in Cent je km */
  kmRate: Cents;
  /** Für die SVS-/ESt-Schätzung */
  svsInsured: boolean;
  /** Sachkonten für BMD-/DATEV-Export (Kontenrahmen EKR) */
  accounts: AccountMapping;
}

export interface AccountMapping {
  bank: string;
  cash: string;
  revenue20: string;
  revenue13: string;
  revenue10: string;
  revenueExempt: string;
  revenueReverseCharge: string;
  revenueIgDelivery: string;
  /** Konto je Ausgabenkategorie (Schlüssel = Kategorie-ID) */
  expense: Record<string, string>;
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
  /** true, wenn in dieser Stufe die Pauschale nach § 458 UGB verrechnet wurde */
  collectionFee?: boolean;
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

/**
 * Steuerfall einer Eingangsrechnung:
 * - domestic: Inland mit ausgewiesener Vorsteuer
 * - reverse_charge: Leistung aus dem EU-Ausland mit Übergang der Steuerschuld (z. B. Software-Abos)
 * - ig_acquisition: innergemeinschaftlicher Erwerb von Waren
 * - none: keine USt (z. B. Kleinunternehmer-Lieferant, Versicherung, Gebühren)
 */
export type InputTaxCase = 'domestic' | 'reverse_charge' | 'ig_acquisition' | 'none';

export interface Receipt {
  /** Pfad relativ zum Datenordner, z. B. belege/2026/<id>.pdf */
  path: string;
  originalName: string;
  sha256: string;
  size: number;
  addedAt: string;
}

/** Ausgabe oder sonstige Einnahme ohne Ausgangsrechnung (E/A-Rechnung) */
export interface Entry {
  id: string;
  kind: 'expense' | 'income';
  /** Belegdatum */
  date: string;
  /** Zahlungsdatum (Zu-/Abfluss); leer = noch nicht bezahlt */
  paidDate: string;
  /** Bezahlt über Bank oder Kassa */
  paidVia: 'bank' | 'cash' | '';
  description: string;
  counterparty: string;
  receiptNumber: string;
  category: string;
  /** Bruttobetrag lt. Beleg */
  gross: Cents;
  vatRate: VatRate;
  taxCase: InputTaxCase;
  /** Vorsteuerabzug zulässig (z. B. nicht bei PKW) */
  inputTaxDeductible: boolean;
  receipts: Receipt[];
  /** Verknüpfte Bankbewegung */
  bankTransactionId?: string;
  /** Bei Kategorie "Anlagegut": erzeugtes Wirtschaftsgut */
  assetId?: string;
  notes: string;
  createdAt: string;
}

export interface Asset {
  id: string;
  name: string;
  acquisitionDate: string;
  /** Datum der Inbetriebnahme (maßgeblich für Halbjahres-AfA) */
  inServiceDate: string;
  /** Anschaffungskosten (netto bei Vorsteuerabzug, sonst brutto) */
  cost: Cents;
  usefulLifeYears: number;
  /** Geringwertiges Wirtschaftsgut – Sofortabschreibung */
  lowValue: boolean;
  disposalDate: string;
  disposalProceeds: Cents;
  /** Anteil der betrieblichen Nutzung in Prozent */
  businessUsePercent: number;
  entryId?: string;
  notes: string;
}

export interface BankAccount {
  id: string;
  name: string;
  kind: 'bank' | 'cash';
  iban: string;
  openingBalance: Cents;
  openingDate: string;
}

export type BankTxLink =
  | { type: 'invoice'; documentId: string; paymentId: string }
  | { type: 'entry'; entryId: string }
  | { type: 'private' }
  | { type: 'transfer' }
  | { type: 'tax' }
  | { type: 'ignored' };

export interface BankTransaction {
  id: string;
  accountId: string;
  date: string;
  amount: Cents;
  counterparty: string;
  counterpartyIban: string;
  purpose: string;
  reference: string;
  /** Prüfwert gegen Doppelimporte */
  hash: string;
  link?: BankTxLink;
  importedAt: string;
}

export interface Trip {
  id: string;
  date: string;
  from: string;
  to: string;
  purpose: string;
  km: number;
  /** Kilometergeld zum Zeitpunkt der Fahrt (Cent/km) */
  rate: Cents;
}

export interface Database {
  version: 1;
  settings: CompanySettings;
  customers: Customer[];
  articles: Article[];
  documents: BusinessDocument[];
  counters: NumberCounters;
  entries: Entry[];
  assets: Asset[];
  bankAccounts: BankAccount[];
  bankTransactions: BankTransaction[];
  trips: Trip[];
}
