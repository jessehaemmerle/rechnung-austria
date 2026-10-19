import { describe, expect, it } from 'vitest';
import { checkInvoice, hasErrors, isValidVatIdFormat } from '../src/core/compliance';
import { addDays, daysBetween } from '../src/core/dates';
import {
  addDunning,
  addPayment,
  cancelInvoice,
  convertOfferToInvoice,
  createDraft,
  deleteDraft,
  finalizeDocument,
  paymentState,
  saveDraft,
} from '../src/core/documents';
import { computeInterest, interestRate } from '../src/core/dunning';
import { formatEuro, parseEuro, roundCents } from '../src/core/money';
import { formatNumber, nextNumber, validatePattern } from '../src/core/numbering';
import { invoicesCsv, yearReport } from '../src/core/reports';
import { checkSmallBusiness, wouldExceedTolerance } from '../src/core/smallBusiness';
import { computeTotals } from '../src/core/tax';
import { renderDocumentHtml } from '../src/core/template';
import { invoice, item, setup } from './fixtures';

describe('Geld', () => {
  it('rundet kaufmännisch', () => {
    expect(roundCents(0.5)).toBe(1);
    expect(roundCents(-0.5)).toBe(-1);
    expect(roundCents(2.4999)).toBe(2);
  });
  it('parst deutsche und englische Beträge', () => {
    expect(parseEuro('1.234,56')).toBe(123456);
    expect(parseEuro('12.5')).toBe(1250);
    expect(parseEuro('€ 3,00')).toBe(300);
    expect(() => parseEuro('abc')).toThrow();
  });
  it('formatiert österreichisch', () => {
    expect(formatEuro(123456).replace(/\s/g, ' ')).toMatch(/1\.234,56/);
  });
});

describe('Steuerberechnung', () => {
  it('rechnet USt je Steuersatz auf die Netto-Summe', () => {
    const db = setup();
    const doc = invoice(db, [item({ unitPrice: 3333, quantity: 3 }), item({ unitPrice: 1000, vatRate: 10 }), item({ unitPrice: 1, quantity: 1, vatRate: 20 })]);
    const t = computeTotals(doc, db.settings);
    expect(t.groups).toEqual([
      { rate: 20, net: 10000, vat: 2000 },
      { rate: 10, net: 1000, vat: 100 },
    ]);
    expect(t.gross).toBe(13100);
  });
  it('berücksichtigt Rabatte', () => {
    const db = setup();
    const t = computeTotals(invoice(db, [item({ unitPrice: 10000, quantity: 2, discountPercent: 10 })]), db.settings);
    expect(t.net).toBe(18000);
    expect(t.vat).toBe(3600);
  });
  it('weist bei Kleinunternehmern keine USt aus', () => {
    const db = setup({ small: true });
    const t = computeTotals(invoice(db, [item({ vatRate: 20 })]), db.settings);
    expect(t.vat).toBe(0);
    expect(t.exemption).toBe('small_business');
  });
  it('weist bei Reverse Charge und ig. Lieferung keine USt aus', () => {
    const db = setup();
    expect(computeTotals(invoice(db, [item()], { taxCase: 'reverse_charge' }), db.settings).exemption).toBe('reverse_charge');
    expect(computeTotals(invoice(db, [item()], { taxCase: 'ig_delivery' }), db.settings).vat).toBe(0);
  });
});

describe('Nummernkreise', () => {
  it('validiert Muster', () => {
    expect(validatePattern('RE-{JJJJ}-{NNNN}')).toBeNull();
    expect(validatePattern('RE-{JJJJ}')).not.toBeNull();
    expect(validatePattern('RE-{X}-{NN}')).not.toBeNull();
  });
  it('formatiert und zählt je Jahr', () => {
    expect(formatNumber('{YY}/{NNN}', 7, '2026-01-01')).toBe('26/007');
    let c = {};
    const a = nextNumber(c, 'invoice', 'RE-{JJJJ}-{NNNN}', '2026-12-31');
    c = a.counters;
    const b = nextNumber(c, 'invoice', 'RE-{JJJJ}-{NNNN}', '2026-12-31');
    const n = nextNumber(b.counters, 'invoice', 'RE-{JJJJ}-{NNNN}', '2027-01-01');
    expect([a.number, b.number, n.number]).toEqual(['RE-2026-0001', 'RE-2026-0002', 'RE-2027-0001']);
  });
  it('zählt ohne Jahr durchgehend', () => {
    const a = nextNumber({}, 'invoice', '{N}', '2026-12-31');
    const b = nextNumber(a.counters, 'invoice', '{N}', '2027-01-01');
    expect(b.number).toBe('2');
  });
});

describe('Pflichtangaben § 11 UStG', () => {
  it('akzeptiert eine vollständige Rechnung', () => {
    const db = setup();
    expect(hasErrors(checkInvoice(invoice(db, [item()]), db.settings, db.customers[0]))).toBe(false);
  });
  it('verlangt die eigene UID ab 400 € (außer Kleinunternehmer)', () => {
    const db = setup();
    db.settings.vatId = '';
    const doc = invoice(db, [item({ unitPrice: 50000 })]);
    expect(checkInvoice(doc, db.settings, db.customers[0]).map((i) => i.message).join()).toMatch(/Eigene UID/);
    const small = invoice(db, [item({ unitPrice: 30000 })]);
    expect(hasErrors(checkInvoice(small, db.settings, db.customers[0]))).toBe(false);
    const ku = setup({ small: true });
    expect(hasErrors(checkInvoice(invoice(ku, [item({ unitPrice: 50000 })]), ku.settings, ku.customers[0]))).toBe(false);
  });
  it('verlangt Kunden-UID ab 10.000 € brutto bei B2B', () => {
    const db = setup();
    const doc = invoice(db, [item({ unitPrice: 900000 })]);
    expect(checkInvoice(doc, db.settings, db.customers[0]).some((i) => /10\.000/.test(i.message))).toBe(true);
  });
  it('erlaubt Kleinbetragsrechnung ohne Kunde', () => {
    const db = setup();
    expect(hasErrors(checkInvoice(invoice(db, [item({ unitPrice: 30000 })]), db.settings, undefined))).toBe(false);
    expect(hasErrors(checkInvoice(invoice(db, [item({ unitPrice: 40000 })]), db.settings, undefined))).toBe(true);
  });
  it('verlangt UIDs bei Reverse Charge', () => {
    const db = setup({ customer: { address: { street: 'X 1', zip: '80331', city: 'München', country: 'DE' } } });
    const doc = invoice(db, [item()], { taxCase: 'reverse_charge' });
    expect(hasErrors(checkInvoice(doc, db.settings, db.customers[0]))).toBe(true);
    db.customers[0].vatId = 'DE123456789';
    expect(hasErrors(checkInvoice(doc, db.settings, db.customers[0]))).toBe(false);
  });
  it('prüft UID-Format', () => {
    expect(isValidVatIdFormat('ATU12345678')).toBe(true);
    expect(isValidVatIdFormat('ATU1234')).toBe(false);
    expect(isValidVatIdFormat('DE123456789')).toBe(true);
  });
  it('verlangt Leistungsdatum', () => {
    const db = setup();
    expect(hasErrors(checkInvoice(invoice(db, [item()], { serviceDateFrom: '' }), db.settings, db.customers[0]))).toBe(true);
  });
});

describe('Dokument-Lebenszyklus', () => {
  it('vergibt Nummern erst beim Finalisieren, lückenlos und unveränderbar', () => {
    let db = setup();
    const d1 = invoice(db, [item()]);
    const d2 = invoice(db, [item()]);
    db = saveDraft(saveDraft(db, d1), d2);
    db = deleteDraft(db, d1.id); // Entwurf löschen erzeugt keine Lücke
    const r = finalizeDocument(db, d2.id);
    expect(r.doc.number).toBe('RE-2026-0001');
    expect(r.doc.companySnapshot?.name).toBe('Muster EPU');
    expect(() => saveDraft(r.db, r.doc)).toThrow();
    expect(() => deleteDraft(r.db, r.doc.id)).toThrow();
  });
  it('verweigert Finalisieren bei fehlenden Pflichtangaben', () => {
    let db = setup();
    const d = invoice(db, [item({ description: '' })]);
    db = saveDraft(db, d);
    expect(() => finalizeDocument(db, d.id)).toThrow(/Bezeichnung/);
  });
  it('wandelt Angebot in Rechnung um', () => {
    let db = setup();
    const offer = createDraft(db, 'offer', 'c1', '2026-02-01');
    offer.items = [item({ description: 'Website' })];
    db = saveDraft(db, offer);
    db = finalizeDocument(db, offer.id).db;
    const res = convertOfferToInvoice(db, offer.id, '2026-03-01');
    expect(res.doc.kind).toBe('invoice');
    expect(res.doc.sourceDocumentId).toBe(offer.id);
    expect(res.db.documents.find((d) => d.id === offer.id)?.offerStatus).toBe('invoiced');
    expect(res.db.documents.find((d) => d.id === offer.id)?.number).toBe('AN-2026-0001');
  });
  it('storniert mit eigener Stornorechnung', () => {
    let db = setup();
    const d = invoice(db, [item()]);
    db = finalizeDocument(saveDraft(db, d), d.id).db;
    const res = cancelInvoice(db, d.id, '2026-04-01');
    expect(res.doc.number).toBe('ST-2026-0001');
    expect(computeTotals(res.doc, db.settings).gross).toBe(-12000);
    expect(res.db.documents.find((x) => x.id === d.id)?.status).toBe('cancelled');
    expect(() => cancelInvoice(res.db, d.id)).toThrow();
  });
  it('verfolgt Zahlungen', () => {
    let db = setup();
    const d = invoice(db, [item()]);
    db = finalizeDocument(saveDraft(db, d), d.id).db;
    const get = () => db.documents.find((x) => x.id === d.id)!;
    expect(paymentState(db, get(), '2026-03-15')).toBe('open');
    expect(paymentState(db, get(), '2026-04-15')).toBe('overdue');
    db = addPayment(db, d.id, { date: '2026-03-20', amount: 5000, note: '' });
    expect(paymentState(db, get(), '2026-03-21')).toBe('partial');
    db = addPayment(db, d.id, { date: '2026-03-21', amount: 7000, note: '' });
    expect(paymentState(db, get(), '2026-05-01')).toBe('paid');
  });
});

describe('Mahnwesen', () => {
  it('berechnet Zinssätze nach UGB und ABGB', () => {
    expect(interestRate({ isBusiness: true }, 1.53)).toBeCloseTo(10.73);
    expect(interestRate({ isBusiness: false }, 1.53)).toBe(4);
  });
  it('berechnet Zinsen taggenau', () => {
    expect(computeInterest(100000, 3.65, '2026-01-01', '2026-01-11')).toBe(100);
    expect(computeInterest(100000, 10, '2026-01-11', '2026-01-01')).toBe(0);
  });
  it('erstellt drei Mahnstufen mit Pauschale bei B2B', () => {
    let db = setup();
    const d = invoice(db, [item({ unitPrice: 100000 })]);
    db = finalizeDocument(saveDraft(db, d), d.id).db;
    const opts = { chargeInterest: true, applyCollectionFee: true };
    expect(() => addDunning(db, d.id, opts, '2026-03-20')).toThrow(/nicht überfällig/);
    db = addDunning(db, d.id, opts, '2026-04-01');
    db = addDunning(db, d.id, opts, '2026-04-15');
    db = addDunning(db, d.id, opts, '2026-05-01');
    const dun = db.documents.find((x) => x.id === d.id)!.dunning;
    expect(dun.map((x) => x.level)).toEqual([1, 2, 3]);
    expect(dun[0].fee).toBe(0);
    expect(dun[1].fee).toBe(4000);
    expect(dun[2].fee).toBe(1500);
    expect(dun[1].interest).toBeGreaterThan(0);
    expect(() => addDunning(db, d.id, opts, '2026-06-01')).toThrow();
  });
});

describe('Kleinunternehmergrenze', () => {
  it('erkennt Annäherung, Toleranz und Überschreitung', () => {
    let db = setup({ small: true });
    const add = (amount: number, date = '2026-05-01') => {
      const d = invoice(db, [item({ unitPrice: amount })], { issueDate: date, serviceDateFrom: date });
      db = finalizeDocument(saveDraft(db, d), d.id).db;
    };
    add(4_500_000);
    expect(checkSmallBusiness(db.documents, db.settings, 2026).status).toBe('approaching');
    add(1_100_000);
    expect(checkSmallBusiness(db.documents, db.settings, 2026).status).toBe('tolerance');
    expect(checkSmallBusiness(db.documents, db.settings, 2027).status).toBe('exceeded');
    const next = invoice(db, [item({ unitPrice: 600_000 })]);
    expect(wouldExceedTolerance(db.documents, next, db.settings)).toBe(true);
  });
});

describe('Auswertungen und Druck', () => {
  it('erstellt Jahresbericht und CSV', () => {
    let db = setup();
    const d = invoice(db, [item(), item({ vatRate: 13, description: '=HACK()' })]);
    db = finalizeDocument(saveDraft(db, d), d.id).db;
    const r = yearReport(db, 2026);
    expect(r.total.gross).toBe(12000 + 11300);
    expect(r.months[2].net).toBe(20000);
    const csv = invoicesCsv(db, 2026);
    expect(csv).toContain('RE-2026-0001');
    expect(csv).toContain('233,00');
  });
  it('rendert Pflichthinweise und escaped HTML', () => {
    const db = setup({ small: true, customer: { name: '<script>x</script>' } });
    const d = invoice(db, [item()]);
    const html = renderDocumentHtml({ doc: d, settings: db.settings, customer: db.customers[0] });
    expect(html).toContain('§ 6 Abs. 1 Z 27 UStG');
    expect(html).not.toContain('<script>x');
  });
  it('rendert Reverse-Charge-Hinweis in Englisch', () => {
    const db = setup();
    const d = invoice(db, [item()], { taxCase: 'reverse_charge', language: 'en' });
    expect(renderDocumentHtml({ doc: d, settings: db.settings, customer: db.customers[0] })).toContain('Reverse charge');
  });
});

describe('Datumshilfen', () => {
  it('rechnet Tage', () => {
    expect(addDays('2026-02-27', 3)).toBe('2026-03-02');
    expect(daysBetween('2026-01-01', '2027-01-01')).toBe(365);
  });
});
