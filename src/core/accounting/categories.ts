/**
 * Ausgaben- und Einnahmenkategorien mit Zuordnung zu den Kennzahlen der Beilage E1a
 * (Einnahmen-Ausgaben-Rechnung) und Standardkonten des österreichischen
 * Einheitskontenrahmens (EKR) für den Export an die Steuerberatung.
 *
 * Hinweis: Kennzahlen bitte jährlich mit dem aktuellen E1a-Formular abgleichen.
 */
export interface Category {
  id: string;
  label: string;
  kind: 'expense' | 'income';
  /** Kennzahl der Beilage E1a */
  e1a: string;
  e1aLabel: string;
  account: string;
  /** Ertragsteuerlich abzugsfähiger Anteil (z. B. Bewirtung 50 %) */
  deductibleShare: number;
  /** Vorschlag für den Vorsteuerabzug */
  inputTaxDefault: boolean;
  hint?: string;
}

export const CATEGORIES: Category[] = [
  { id: 'goods', label: 'Waren, Rohstoffe, Hilfsstoffe', kind: 'expense', e1a: '9100', e1aLabel: 'Waren, Rohstoffe, Hilfsstoffe', account: '5000', deductibleShare: 1, inputTaxDefault: true },
  { id: 'subcontractors', label: 'Fremdleistungen, Subunternehmer', kind: 'expense', e1a: '9110', e1aLabel: 'Fremdpersonal und Fremdleistungen', account: '5800', deductibleShare: 1, inputTaxDefault: true },
  { id: 'asset', label: 'Anlagegut (wird abgeschrieben)', kind: 'expense', e1a: '9130', e1aLabel: 'Abschreibungen auf das Anlagevermögen', account: '0600', deductibleShare: 1, inputTaxDefault: true, hint: 'Erzeugt einen Eintrag im Anlagenverzeichnis. Bis 1.000 € netto wird es als GWG sofort abgeschrieben – im Anlagenverzeichnis auf AfA umstellbar.' },
  { id: 'car_asset', label: 'PKW (Anlagegut)', kind: 'expense', e1a: '9130', e1aLabel: 'Abschreibungen auf das Anlagevermögen', account: '0630', deductibleShare: 1, inputTaxDefault: false, hint: 'Nutzungsdauer mind. 8 Jahre, kein Vorsteuerabzug (außer Elektro-PKW), Luxustangente ab 40.000 € beachten.' },
  { id: 'repairs', label: 'Instandhaltung, Reparaturen', kind: 'expense', e1a: '9150', e1aLabel: 'Instandhaltungen für Gebäude', account: '7200', deductibleShare: 1, inputTaxDefault: true },
  { id: 'travel', label: 'Reisekosten, Taggelder, Öffis', kind: 'expense', e1a: '9160', e1aLabel: 'Reise- und Fahrtspesen inkl. Kilometergeld', account: '7300', deductibleShare: 1, inputTaxDefault: true },
  { id: 'car', label: 'KFZ-Kosten (Treibstoff, Service, Versicherung)', kind: 'expense', e1a: '9170', e1aLabel: 'Kfz-Kosten', account: '7320', deductibleShare: 1, inputTaxDefault: false, hint: 'Bei PKW (außer Elektroauto) kein Vorsteuerabzug.' },
  { id: 'rent', label: 'Miete, Pacht, Leasing', kind: 'expense', e1a: '9180', e1aLabel: 'Miet- und Pachtaufwand, Leasing', account: '7400', deductibleShare: 1, inputTaxDefault: true },
  { id: 'commissions', label: 'Provisionen, Lizenzgebühren', kind: 'expense', e1a: '9190', e1aLabel: 'Provisionen an Dritte, Lizenzgebühren', account: '7700', deductibleShare: 1, inputTaxDefault: true },
  { id: 'marketing', label: 'Werbung, Marketing', kind: 'expense', e1a: '9200', e1aLabel: 'Werbe- und Repräsentationsaufwendungen', account: '7650', deductibleShare: 1, inputTaxDefault: true },
  { id: 'hospitality', label: 'Geschäftsessen (50 %)', kind: 'expense', e1a: '9200', e1aLabel: 'Werbe- und Repräsentationsaufwendungen', account: '7660', deductibleShare: 0.5, inputTaxDefault: true, hint: 'Bewirtung mit Werbezweck: 50 % absetzbar, Zweck und Teilnehmer am Beleg vermerken.' },
  { id: 'interest', label: 'Zinsen, Bankspesen', kind: 'expense', e1a: '9220', e1aLabel: 'Zinsen und ähnliche Aufwendungen', account: '7790', deductibleShare: 1, inputTaxDefault: false },
  { id: 'svs', label: 'SVS-Beiträge (eigene)', kind: 'expense', e1a: '9225', e1aLabel: 'Eigene Pflichtversicherungsbeiträge', account: '7060', deductibleShare: 1, inputTaxDefault: false },
  { id: 'office', label: 'Büromaterial, Porto', kind: 'expense', e1a: '9230', e1aLabel: 'Übrige Aufwendungen', account: '7600', deductibleShare: 1, inputTaxDefault: true },
  { id: 'software', label: 'Software, IT, Hosting', kind: 'expense', e1a: '9230', e1aLabel: 'Übrige Aufwendungen', account: '7610', deductibleShare: 1, inputTaxDefault: true },
  { id: 'telecom', label: 'Telefon, Internet', kind: 'expense', e1a: '9230', e1aLabel: 'Übrige Aufwendungen', account: '7380', deductibleShare: 1, inputTaxDefault: true },
  { id: 'training', label: 'Fortbildung, Fachliteratur', kind: 'expense', e1a: '9230', e1aLabel: 'Übrige Aufwendungen', account: '7750', deductibleShare: 1, inputTaxDefault: true },
  { id: 'insurance', label: 'Versicherungen (betrieblich)', kind: 'expense', e1a: '9230', e1aLabel: 'Übrige Aufwendungen', account: '7700', deductibleShare: 1, inputTaxDefault: false },
  { id: 'fees', label: 'Gebühren, Beiträge (z. B. WKO)', kind: 'expense', e1a: '9230', e1aLabel: 'Übrige Aufwendungen', account: '7780', deductibleShare: 1, inputTaxDefault: false },
  { id: 'consulting', label: 'Steuerberatung, Rechtsberatung', kind: 'expense', e1a: '9230', e1aLabel: 'Übrige Aufwendungen', account: '7750', deductibleShare: 1, inputTaxDefault: true },
  { id: 'other_expense', label: 'Sonstige Ausgaben', kind: 'expense', e1a: '9230', e1aLabel: 'Übrige Aufwendungen', account: '7800', deductibleShare: 1, inputTaxDefault: true },
  { id: 'revenue_other', label: 'Erlöse ohne Ausgangsrechnung', kind: 'income', e1a: '9040', e1aLabel: 'Erlöse aus Lieferungen und Leistungen', account: '4000', deductibleShare: 1, inputTaxDefault: false },
  { id: 'income_other', label: 'Übrige Erträge (z. B. Förderungen, Zinsen)', kind: 'income', e1a: '9090', e1aLabel: 'Übrige Erträge', account: '4800', deductibleShare: 1, inputTaxDefault: false },
];

/** Kilometergeld wird nicht als Beleg erfasst, sondern aus dem Fahrtenbuch berechnet. */
export const KM_ALLOWANCE = { e1a: '9160', e1aLabel: 'Reise- und Fahrtspesen inkl. Kilometergeld', account: '7330' };

export function categoryById(id: string): Category {
  return CATEGORIES.find((c) => c.id === id) ?? CATEGORIES.find((c) => c.id === 'other_expense')!;
}
