import { describe, expect, it } from 'vitest';
import { cancelInvoice, finalizeDocument, saveDraft } from '../src/core/documents';
import { toCii } from '../src/core/einvoice/cii';
import { toEbInterface } from '../src/core/einvoice/ebinterface';
import { buildModel, unitCode } from '../src/core/einvoice/model';
import { toUbl } from '../src/core/einvoice/ubl';
import type { Database } from '../src/core/types';
import { invoice, item, setup } from './fixtures';

function finalInvoice(db: Database, overrides = {}) {
  const d = invoice(db, [item({ description: 'Beratung & Co <Test>', quantity: 2, unit: 'h', discountPercent: 10 }), item({ vatRate: 10 })], overrides);
  const r = finalizeDocument(saveDraft(db, d), d.id);
  return { db: r.db, doc: r.doc };
}

function wellFormed(xmlText: string) {
  // Minimalprüfung: keine unescapten Sonderzeichen und ausgeglichene Tags
  expect(xmlText).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;)/);
  const opens = (xmlText.match(/<[A-Za-z][^>]*[^/]>/g) ?? []).filter((t) => !t.startsWith('<?')).length;
  const closes = (xmlText.match(/<\/[^>]+>/g) ?? []).length;
  expect(opens).toBe(closes);
}

describe('E-Rechnung', () => {
  it('mappt Einheiten auf UN/ECE-Codes', () => {
    expect(unitCode('Stk')).toBe('H87');
    expect(unitCode('h')).toBe('HUR');
    expect(unitCode('Pauschal')).toBe('LS');
    expect(unitCode('Foo')).toBe('C62');
  });

  it('erzeugt ebInterface 6.1', () => {
    const { db, doc } = finalInvoice(setup());
    const out = toEbInterface(buildModel(doc, db.settings, db.customers[0]));
    wellFormed(out);
    expect(out).toContain('http://www.ebinterface.at/schema/6p1/');
    expect(out).toContain('<InvoiceNumber>RE-2026-0001</InvoiceNumber>');
    expect(out).toContain('Beratung &amp; Co &lt;Test&gt;');
    expect(out).toContain('<TaxPercent TaxCategoryCode="AA">10.00</TaxPercent>');
    expect(out).toContain('<TotalGrossAmount>326.00</TotalGrossAmount>');
  });

  it('kennzeichnet Kleinunternehmer als befreit', () => {
    const ku = setup({ small: true });
    const { db, doc } = finalInvoice(ku);
    const m = buildModel(doc, db.settings, db.customers[0]);
    expect(m.groups.every((g) => g.category === 'E')).toBe(true);
    expect(toEbInterface(m)).toContain('<VATIdentificationNumber>00000000</VATIdentificationNumber>');
    expect(toUbl(m)).toContain('Kleinunternehmer');
    expect(toCii(m)).toContain('<ram:CategoryCode>E</ram:CategoryCode>');
  });

  it('erzeugt XRechnung UBL mit Reverse Charge', () => {
    const db0 = setup({ customer: { vatId: 'DE123456789', address: { street: 'X 1', zip: '80331', city: 'München', country: 'DE' } } });
    const { db, doc } = finalInvoice(db0, { taxCase: 'reverse_charge' });
    const out = toUbl(buildModel(doc, db.settings, db.customers[0]));
    wellFormed(out);
    expect(out).toContain('<cbc:ID>AE</cbc:ID>');
    expect(out).toContain('VATEX-EU-AE');
    expect(out).toContain('<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>');
    expect(out).toContain('<cbc:TaxAmount currencyID="EUR">0.00</cbc:TaxAmount>');
  });

  it('erzeugt Stornos als CreditNote mit positiven Beträgen', () => {
    const { db } = finalInvoice(setup());
    const inv = db.documents[0];
    const res = cancelInvoice(db, inv.id, '2026-04-01');
    const m = buildModel(res.doc, res.db.settings, res.db.customers[0], inv);
    const ubl = toUbl(m);
    wellFormed(ubl);
    expect(ubl).toContain('<CreditNote');
    expect(ubl).toContain('<cbc:CreditNoteTypeCode>381</cbc:CreditNoteTypeCode>');
    expect(ubl).toContain('<cbc:PayableAmount currencyID="EUR">326.00</cbc:PayableAmount>');
    expect(ubl).toContain('RE-2026-0001');
    const cii = toCii(m);
    expect(cii).toContain('<ram:GrandTotalAmount>326.00</ram:GrandTotalAmount>');
    expect(toEbInterface(m)).toContain('<TotalGrossAmount>-326.00</TotalGrossAmount>');
  });

  it('erzeugt Factur-X CII', () => {
    const { db, doc } = finalInvoice(setup());
    const out = toCii(buildModel(doc, db.settings, db.customers[0]));
    wellFormed(out);
    expect(out).toContain('urn:cen.eu:en16931:2017');
    expect(out).toContain('<ram:BasisAmount>180.00</ram:BasisAmount>');
    expect(out).toContain('<ram:DuePayableAmount>326.00</ram:DuePayableAmount>');
  });

  it('lehnt Entwürfe und Angebote ab', () => {
    const db = setup();
    expect(() => buildModel(invoice(db, [item()]), db.settings, db.customers[0])).toThrow();
  });
});
