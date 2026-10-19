import { computeTotals } from './tax';
import type { BusinessDocument, CompanySettings, Customer } from './types';

export interface ComplianceIssue {
  level: 'error' | 'warning';
  message: string;
}

/** Kleinbetragsrechnung: Gesamtbetrag bis 400 € brutto (§ 11 Abs 6 UStG). */
export const SMALL_INVOICE_LIMIT = 40_000;
/** Ab 10.000 € brutto ist die UID des Empfängers anzugeben (§ 11 Abs 1 Z 3 lit j UStG). */
export const RECIPIENT_VATID_LIMIT = 1_000_000;

const UID_RE = /^[A-Z]{2}[0-9A-Z+*.]{2,13}$/;
const AT_UID_RE = /^ATU\d{8}$/;

export function isValidVatIdFormat(vatId: string): boolean {
  const v = vatId.replace(/\s/g, '').toUpperCase();
  if (v.startsWith('AT')) return AT_UID_RE.test(v);
  return UID_RE.test(v);
}

export function isEuCountry(country: string): boolean {
  return EU_COUNTRIES.has(country.toUpperCase());
}

export const EU_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU',
  'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK',
]);

export function isSmallAmountInvoice(doc: BusinessDocument, settings: CompanySettings): boolean {
  return Math.abs(computeTotals(doc, settings).gross) <= SMALL_INVOICE_LIMIT;
}

/**
 * Prüft die Rechnungsmerkmale nach § 11 UStG. Fehler (level=error) verhindern
 * das Finalisieren, Warnungen werden nur angezeigt.
 */
export function checkInvoice(doc: BusinessDocument, settings: CompanySettings, customer: Customer | undefined): ComplianceIssue[] {
  const issues: ComplianceIssue[] = [];
  const err = (message: string) => issues.push({ level: 'error', message });
  const warn = (message: string) => issues.push({ level: 'warning', message });
  const totals = computeTotals(doc, settings);
  const small = Math.abs(totals.gross) <= SMALL_INVOICE_LIMIT;
  const isInvoice = doc.kind !== 'offer';

  // lit a: Name und Anschrift des Leistenden (auch bei Kleinbetragsrechnungen)
  if (!settings.name.trim()) err('Name des Unternehmens fehlt (Einstellungen).');
  if (!settings.address.street.trim() || !settings.address.zip.trim() || !settings.address.city.trim())
    err('Anschrift des Unternehmens ist unvollständig (Einstellungen).');

  // lit c: Menge und handelsübliche Bezeichnung
  if (doc.items.length === 0) err('Das Dokument enthält keine Positionen.');
  doc.items.forEach((it, i) => {
    if (!it.description.trim()) err(`Position ${i + 1}: Bezeichnung fehlt.`);
    if (!(it.quantity > 0) && doc.kind !== 'credit_note') err(`Position ${i + 1}: Menge muss größer als 0 sein.`);
  });

  if (!doc.issueDate) err('Ausstellungsdatum fehlt.');

  if (!isInvoice) {
    if (!customer) err('Kein Kunde ausgewählt.');
    return issues;
  }

  // lit d: Tag/Zeitraum der Leistung
  if (!doc.serviceDateFrom) err('Leistungsdatum bzw. Leistungszeitraum fehlt.');
  if (doc.serviceDateTo && doc.serviceDateTo < doc.serviceDateFrom)
    err('Ende des Leistungszeitraums liegt vor dessen Beginn.');

  if (!customer) {
    // Bei Kleinbetragsrechnungen ist der Empfänger nicht verpflichtend.
    if (!small) err('Kein Kunde ausgewählt (Pflicht ab 400 € brutto).');
  } else if (!small) {
    // lit b: Name und Anschrift des Empfängers
    if (!customer.name.trim()) err('Name des Kunden fehlt.');
    if (!customer.address.street.trim() || !customer.address.city.trim())
      err('Anschrift des Kunden ist unvollständig.');
  }

  // lit i: UID des Leistenden (bei Rechnungen über 400 €; Kleinunternehmer ohne UID sind ausgenommen)
  if (!small && !settings.vatId.trim() && !settings.isSmallBusiness)
    err('Eigene UID-Nummer fehlt (Pflicht bei Rechnungen über 400 €).');
  if (settings.vatId.trim() && !isValidVatIdFormat(settings.vatId))
    warn('Eigene UID-Nummer hat kein gültiges Format (z. B. ATU12345678).');

  const custVat = customer?.vatId.trim() ?? '';
  if (doc.taxCase === 'reverse_charge' || doc.taxCase === 'ig_delivery') {
    const label = doc.taxCase === 'reverse_charge' ? 'Reverse Charge' : 'innergemeinschaftliche Lieferung';
    if (!settings.vatId.trim()) err(`Für ${label} ist eine eigene UID-Nummer erforderlich.`);
    if (!custVat) err(`Für ${label} ist die UID-Nummer des Kunden erforderlich.`);
    else if (!isValidVatIdFormat(custVat)) warn('UID-Nummer des Kunden hat kein gültiges Format.');
    if (customer && !customer.isBusiness) err(`${label} ist nur an Unternehmer möglich.`);
    if (customer && customer.address.country.toUpperCase() === 'AT')
      warn(`${label}: Kunde hat Sitz in Österreich – bitte Steuerfall prüfen.`);
    if (customer && !isEuCountry(customer.address.country))
      warn(`${label} gilt nur für Kunden in der EU – bei Drittland ist der Leistungsort gesondert zu prüfen.`);
    if (custVat && custVat.toUpperCase().startsWith('AT'))
      warn('Kunden-UID ist österreichisch – Reverse Charge/ig. Lieferung prüfen.');
    if (custVat) warn('Bitte UID des Kunden über MIAS/FinanzOnline (Stufe 2) prüfen und Bestätigung aufbewahren.');
  } else if (customer?.isBusiness && Math.abs(totals.gross) > RECIPIENT_VATID_LIMIT && !custVat && !settings.isSmallBusiness) {
    // lit j: UID des Empfängers bei Gesamtbetrag über 10.000 €
    err('UID-Nummer des Kunden ist ab 10.000 € brutto anzugeben.');
  }

  if (doc.kind === 'credit_note' && !doc.sourceDocumentId) err('Stornorechnung ohne Bezug auf eine Originalrechnung.');
  if (!doc.dueDate) warn('Kein Fälligkeitsdatum angegeben.');
  if (!settings.iban.trim()) warn('Keine IBAN hinterlegt – Kunde weiß nicht, wohin er zahlen soll.');
  return issues;
}

export function hasErrors(issues: ComplianceIssue[]): boolean {
  return issues.some((i) => i.level === 'error');
}
