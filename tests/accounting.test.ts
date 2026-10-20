import { describe, expect, it } from 'vitest';
import { afaSchedule } from '../src/core/accounting/assets';
import { applyMapping, detectMapping, parseAmount, parseCamt053, parseCsv, parseDate, suggestMatches } from '../src/core/accounting/bank';
import { earReport } from '../src/core/accounting/ear';
import { emptyEntry, entryAmounts } from '../src/core/accounting/entries';
import { estimateTaxes, incomeTax } from '../src/core/accounting/estimate';
import { bmdCsv, buildJournal, datevCsv } from '../src/core/accounting/export';
import {
  addCashMovement, deleteEntry, entryFromTransaction, importTransactions, linkToInvoice, markTransaction, saveBankAccount, saveEntry, saveTrip, unlinkTransaction,
} from '../src/core/accounting/ledger';
import { kmAllowanceForYear } from '../src/core/accounting/trips';
import { accrualDate, computeUva, periodsOfYear, vatDueDate } from '../src/core/accounting/vat';
import { validateDatabase } from '../src/core/defaults';
import { finalizeDocument, saveDraft } from '../src/core/documents';
import type { Asset, Database, Entry } from '../src/core/types';
import { invoice, item, setup } from './fixtures';

const expense = (db: Database, o: Partial<Entry>): Entry => ({ ...emptyEntry('expense', '2026-03-05', db.settings), ...o });

function withBank(db: Database): Database {
  db = saveBankAccount(db, { id: 'bank', name: 'Girokonto', kind: 'bank', iban: '', openingBalance: 0, openingDate: '2026-01-01' });
  return saveBankAccount(db, { id: 'cash', name: 'Kassa', kind: 'cash', iban: '', openingBalance: 10000, openingDate: '2026-01-01' });
}

describe('Ausgaben und Vorsteuer', () => {
  it('zerlegt Inlandsbelege in Netto und Vorsteuer', () => {
    const db = setup();
    expect(entryAmounts(expense(db, { gross: 12000, vatRate: 20, inputTaxDeductible: true }), db.settings)).toEqual({ net: 10000, vat: 2000, inputTax: 2000, incomeTaxAmount: 10000 });
  });
  it('setzt ohne Vorsteuerabzug brutto ab (PKW, Kleinunternehmer)', () => {
    const db = setup();
    expect(entryAmounts(expense(db, { gross: 12000, inputTaxDeductible: false }), db.settings).incomeTaxAmount).toBe(12000);
    const ku = setup({ small: true });
    expect(entryAmounts(expense(ku, { gross: 12000, inputTaxDeductible: true }), ku.settings)).toMatchObject({ inputTax: 0, incomeTaxAmount: 12000 });
  });
  it('rechnet Reverse Charge neutral (Steuer = Vorsteuer)', () => {
    const db = setup();
    const a = entryAmounts(expense(db, { gross: 5000, taxCase: 'reverse_charge', inputTaxDeductible: true }), db.settings);
    expect(a).toEqual({ net: 5000, vat: 1000, inputTax: 1000, incomeTaxAmount: 5000 });
  });
  it('berücksichtigt 50 % bei Geschäftsessen', () => {
    const db = setup();
    expect(entryAmounts(expense(db, { gross: 12000, category: 'hospitality', inputTaxDeductible: true }), db.settings).incomeTaxAmount).toBe(5000);
  });
  it('legt Anlagegüter automatisch an (GWG bis 1.000 €)', () => {
    let db = setup();
    db = saveEntry(db, expense(db, { category: 'asset', gross: 120000, description: 'Laptop', inputTaxDeductible: true })).db;
    expect(db.assets[0]).toMatchObject({ name: 'Laptop', cost: 100000, lowValue: true });
    db = saveEntry(db, { ...db.entries[0], gross: 180000 }).db;
    expect(db.assets).toHaveLength(1);
    expect(db.assets[0]).toMatchObject({ cost: 150000, lowValue: false });
  });
  it('schützt Buchungen mit Beleg vor dem Löschen', () => {
    let db = setup();
    db = saveEntry(db, expense(db, { gross: 1000 })).db;
    db = { ...db, entries: [{ ...db.entries[0], receipts: [{ path: 'belege/2026/x.pdf', originalName: 'x.pdf', sha256: 'a', size: 1, addedAt: '' }] }] };
    expect(() => deleteEntry(db, db.entries[0].id)).toThrow(/Aufbewahrungspflicht/);
  });
});

describe('AfA', () => {
  const asset = (o: Partial<Asset>): Asset => ({
    id: 'a', name: 'PC', acquisitionDate: '2026-03-01', inServiceDate: '2026-03-01', cost: 300000, usefulLifeYears: 3, lowValue: false,
    disposalDate: '', disposalProceeds: 0, businessUsePercent: 100, notes: '', ...o,
  });
  it('schreibt linear mit Halbjahresregel ab', () => {
    expect(afaSchedule(asset({})).map((r) => r.afa)).toEqual([100000, 100000, 100000]);
    expect(afaSchedule(asset({ inServiceDate: '2026-09-01' })).map((r) => [r.year, r.afa])).toEqual([[2026, 50000], [2027, 100000], [2028, 100000], [2029, 50000]]);
  });
  it('berücksichtigt Privatanteil und Ausscheiden', () => {
    expect(afaSchedule(asset({ businessUsePercent: 60 }))[0].afa).toBe(60000);
    const rows = afaSchedule(asset({ disposalDate: '2027-03-01' }));
    expect(rows.map((r) => [r.year, r.afa, r.disposalLoss])).toEqual([[2026, 100000, 0], [2027, 50000, 150000]]);
  });
  it('setzt GWG sofort ab', () => {
    expect(afaSchedule(asset({ cost: 90000, lowValue: true }))).toEqual([{ year: 2026, afa: 90000, bookValue: 0, disposalLoss: 0 }]);
  });
});

describe('UVA', () => {
  function scenario(basis: 'ist' | 'soll') {
    let db = setup();
    db = { ...db, settings: { ...db.settings, taxationBasis: basis } };
    const inv = invoice(db, [item({ unitPrice: 100000 }), item({ unitPrice: 10000, vatRate: 10 })], { issueDate: '2026-03-31', serviceDateFrom: '2026-03-15' });
    db = finalizeDocument(saveDraft(db, inv), inv.id).db;
    db = { ...db, documents: db.documents.map((d) => ({ ...d, payments: [{ id: 'p', date: '2026-04-10', amount: 131000, note: '' }] })) };
    db = saveEntry(db, expense(db, { date: '2026-03-20', paidDate: '2026-04-02', gross: 24000, inputTaxDeductible: true })).db;
    db = saveEntry(db, expense(db, { date: '2026-02-10', paidDate: '2026-02-10', gross: 10000, taxCase: 'reverse_charge', inputTaxDeductible: true, category: 'software' })).db;
    return db;
  }
  it('Soll-Besteuerung: nach Leistungsmonat', () => {
    const db = scenario('soll');
    const [q1] = periodsOfYear(2026, 'quarterly');
    const r = computeUva(db, q1);
    expect(r).toMatchObject({ kz000: 110000, kz022: 100000, vat20: 20000, kz029: 10000, vat10: 1000, kz060: 4000, kz057: 2000, kz066: 2000 });
    expect(r.payable).toBe(21000 - 4000);
  });
  it('Ist-Besteuerung: nach Zahlungseingang/-ausgang', () => {
    const db = scenario('ist');
    const [q1, q2] = periodsOfYear(2026, 'quarterly');
    expect(computeUva(db, q1)).toMatchObject({ kz000: 0, kz060: 0, kz057: 2000 });
    expect(computeUva(db, q2)).toMatchObject({ kz000: 110000, vat20: 20000, kz060: 4000 });
  });
  it('trennt EU-Leistungen (nur ZM) und ig. Lieferungen', () => {
    let db = setup({ customer: { vatId: 'DE123456789', address: { street: 'X 1', zip: '1', city: 'B', country: 'DE' } } });
    db = { ...db, settings: { ...db.settings, taxationBasis: 'soll' } };
    for (const taxCase of ['reverse_charge', 'ig_delivery'] as const) {
      const d = invoice(db, [item({ unitPrice: 50000 })], { taxCase });
      db = finalizeDocument(saveDraft(db, d), d.id).db;
    }
    const r = computeUva(db, periodsOfYear(2026, 'monthly')[2]);
    expect(r).toMatchObject({ zmServices: 50000, kz017: 50000, kz000: 50000, payable: 0 });
  });
  it('berechnet Fälligkeit und Steuerentstehung', () => {
    expect(vatDueDate(periodsOfYear(2026, 'quarterly')[0])).toBe('2026-05-15');
    expect(vatDueDate(periodsOfYear(2026, 'monthly')[11])).toBe('2027-02-15');
    const db = setup();
    expect(accrualDate(invoice(db, [], { serviceDateFrom: '2026-01-20', issueDate: '2026-03-05' }))).toBe('2026-02-01');
    expect(accrualDate(invoice(db, [], { serviceDateFrom: '2026-01-20', issueDate: '2026-01-31' }))).toBe('2026-01-01');
  });
});

describe('E/A-Rechnung und Steuerschätzung', () => {
  it('ermittelt Gewinn nach Zufluss-/Abflussprinzip', () => {
    let db = setup({ customer: { vatId: 'ATU87654321' } });
    const inv = invoice(db, [item({ unitPrice: 4_000_000 })]);
    db = finalizeDocument(saveDraft(db, inv), inv.id).db;
    db = { ...db, documents: db.documents.map((d) => ({ ...d, payments: [{ id: 'p', date: '2026-05-01', amount: 4_800_000, note: '' }] })) };
    db = saveEntry(db, expense(db, { gross: 120000, paidDate: '2026-06-01', category: 'software', inputTaxDeductible: true })).db;
    db = saveEntry(db, expense(db, { gross: 300000, paidDate: '2026-02-01', category: 'svs', vatRate: 0, taxCase: 'none' })).db;
    db = saveEntry(db, expense(db, { gross: 50000, paidDate: '', category: 'office' })).db; // unbezahlt: zählt nicht
    db = saveTrip(db, { id: '', date: '2026-04-01', from: 'Wien', to: 'Linz', purpose: 'Kunde', km: 370, rate: 50 });
    const r = earReport(db, 2026);
    expect(r.totalIncome).toBe(4_000_000);
    expect(r.totalExpenses).toBe(100000 + 300000 + 18500);
    expect(r.profit).toBe(4_000_000 - 418500);
    expect(r.basicAllowance).toBe(495000);
    expect(r.svsPaid).toBe(300000);
    expect(earReport(db, 2025).totalIncome).toBe(0);
  });
  it('rechnet den ESt-Tarif stufenweise', () => {
    expect(incomeTax(1_000_000, 2025)).toBe(0);
    // 2025: (21.617 − 13.308) × 20 % + (30.000 − 21.617) × 30 %
    expect(incomeTax(3_000_000, 2025)).toBe(166180 + 251490);
    const e = estimateTaxes(3_000_000, 500_000, 2026);
    expect(e.svs.total).toBeGreaterThan(0);
    expect(e.reserve).toBe(e.incomeTax + Math.max(0, e.svsDifference));
  });
  it('begrenzt Kilometergeld auf 30.000 km', () => {
    const trips = [40_000, 1000].map((km, i) => ({ id: String(i), date: `2026-0${i + 1}-01`, from: '', to: '', purpose: 'x', km, rate: 50 }));
    expect(kmAllowanceForYear(trips, 2026)).toEqual({ km: 30_000, amount: 1_500_000, cappedKm: 11_000 });
  });
});

describe('Bankimport', () => {
  it('liest Beträge und Datumsformate', () => {
    expect(parseAmount('+1.234,56')).toBe(123456);
    expect(parseAmount('-12,00')).toBe(-1200);
    expect(parseAmount('1,234.56')).toBe(123456);
    expect(parseDate('03.02.26')).toBe('2026-02-03');
    expect(parseDate('2026-02-03T10:00:00')).toBe('2026-02-03');
  });
  it('erkennt ELBA (ohne Kopfzeile)', () => {
    const rows = parseCsv('01.03.2026;Gutschrift Kunde GmbH RE-2026-0001;01.03.2026;+120,00;EUR;01.03.2026 10:00:00:000\n02.03.2026;Abbuchung A1;02.03.2026;-45,90;EUR;x\n');
    const { format, mapping } = detectMapping(rows);
    expect(format).toBe('elba');
    const { txs } = applyMapping(rows, mapping);
    expect(txs.map((t) => [t.date, t.amount])).toEqual([['2026-03-01', 12000], ['2026-03-02', -4590]]);
  });
  it('erkennt George-CSV mit Kopfzeile', () => {
    const csv = '"Buchungsdatum";"Partnername";"Partner IBAN";"Betrag";"Währung";"Verwendungszweck";"Zahlungsreferenz"\n"05.03.2026";"Kunde GmbH";"AT12 3456";"1.200,00";"EUR";"Danke";"RE-2026-0001"\n';
    const rows = parseCsv(csv);
    const { format, mapping } = detectMapping(rows);
    expect(format).toBe('george');
    expect(applyMapping(rows, mapping).txs[0]).toMatchObject({ date: '2026-03-05', amount: 120000, counterparty: 'Kunde GmbH', counterpartyIban: 'AT123456', reference: 'RE-2026-0001' });
  });
  it('liest camt.053', () => {
    const xml = `<Document><BkToCstmrStmt><Stmt>
      <Ntry><Amt Ccy="EUR">120.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>2026-03-05</Dt></BookgDt>
        <NtryDtls><TxDtls><RltdPties><Dbtr><Nm>Kunde &amp; Co</Nm></Dbtr><DbtrAcct><Id><IBAN>AT11</IBAN></Id></DbtrAcct></RltdPties>
        <RmtInf><Ustrd>RE-2026-0001</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
      <Ntry><Amt Ccy="EUR">9.90</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2026-03-06</Dt></BookgDt>
        <NtryDtls><TxDtls><RltdPties><Cdtr><Nm>Hosting AG</Nm></Cdtr></RltdPties></TxDtls></NtryDtls></Ntry>
    </Stmt></BkToCstmrStmt></Document>`;
    expect(parseCamt053(xml)).toEqual([
      { date: '2026-03-05', amount: 12000, counterparty: 'Kunde & Co', counterpartyIban: 'AT11', purpose: 'RE-2026-0001', reference: '' },
      { date: '2026-03-06', amount: -990, counterparty: 'Hosting AG', counterpartyIban: '', purpose: '', reference: '' },
    ]);
  });
  it('überspringt Doppelimporte und ordnet Zahlungen zu', () => {
    let db = withBank(setup());
    const inv = invoice(db, [item()]);
    db = finalizeDocument(saveDraft(db, inv), inv.id).db;
    const txs = [{ date: '2026-03-20', amount: 12000, counterparty: 'Kunde GmbH', counterpartyIban: '', purpose: 'RE-2026-0001', reference: '' }];
    const r1 = importTransactions(db, 'bank', txs);
    const r2 = importTransactions(r1.db, 'bank', txs);
    expect([r1.added, r2.added, r2.duplicates]).toEqual([1, 0, 1]);
    db = r1.db;
    const tx = db.bankTransactions.find((t) => t.accountId === 'bank')!;
    const sug = suggestMatches(db, tx);
    expect(sug[0]).toMatchObject({ type: 'invoice', id: inv.id });
    db = linkToInvoice(db, tx.id, inv.id);
    expect(db.documents[0].payments).toHaveLength(1);
    expect(() => linkToInvoice(db, tx.id, inv.id)).toThrow();
    db = unlinkTransaction(db, tx.id);
    expect(db.documents[0].payments).toHaveLength(0);
  });
  it('legt aus einer Abbuchung eine Ausgabe an und markiert Privatentnahmen', () => {
    let db = withBank(setup());
    db = importTransactions(db, 'bank', [
      { date: '2026-03-06', amount: -2400, counterparty: 'A1', counterpartyIban: '', purpose: 'Rechnung 123', reference: '' },
      { date: '2026-03-07', amount: -50000, counterparty: 'Ich', counterpartyIban: '', purpose: 'Privat', reference: '' },
    ]).db;
    const [t1, t2] = db.bankTransactions;
    const res = entryFromTransaction(db, t1.id, expense(db, { category: 'telecom', inputTaxDeductible: true, date: '' }));
    expect(res.entry).toMatchObject({ gross: 2400, paidDate: '2026-03-06', bankTransactionId: t1.id, kind: 'expense' });
    db = markTransaction(res.db, t2.id, 'private');
    expect(db.bankTransactions.find((t) => t.id === t2.id)?.link).toEqual({ type: 'private' });
  });
  it('führt Barzahlungen im Kassabuch', () => {
    let db = withBank(setup());
    db = saveEntry(db, expense(db, { gross: 1500, paidVia: 'cash', paidDate: '2026-03-05' })).db;
    const cashTx = db.bankTransactions.filter((t) => t.accountId === 'cash');
    expect(cashTx).toHaveLength(1);
    expect(cashTx[0].amount).toBe(-1500);
    db = saveEntry(db, { ...db.entries[0], paidVia: 'bank' }).db;
    expect(db.bankTransactions.filter((t) => t.accountId === 'cash')).toHaveLength(0);
    db = addCashMovement(db, { date: '2026-03-01', amount: 20000, purpose: 'Bareinlage', type: 'private' });
    expect(db.bankTransactions.filter((t) => t.accountId === 'cash')).toHaveLength(1);
  });
});

describe('Export und Datenprüfung', () => {
  it('erzeugt BMD- und DATEV-Buchungen', () => {
    let db = setup();
    const inv = invoice(db, [item()]);
    db = finalizeDocument(saveDraft(db, inv), inv.id).db;
    db = { ...db, documents: db.documents.map((d) => ({ ...d, payments: [{ id: 'p', date: '2026-04-10', amount: 12000, note: '' }] })) };
    db = saveEntry(db, expense(db, { gross: 2400, paidDate: '2026-04-11', category: 'telecom', inputTaxDeductible: true, receiptNumber: 'A1-77', counterparty: '=cmd' })).db;
    const j = buildJournal(db, 2026);
    expect(j.map((l) => [l.debit, l.credit, l.amount, l.tax, l.taxKind])).toEqual([['2800', '4000', 12000, 2000, 'ust'], ['7380', '2800', 2400, 400, 'vst']]);
    const bmd = bmdCsv(j);
    expect(bmd).toContain('0;2800;4000;RE-2026-0001;10.04.2026;BK;1;20;1;120,00;20,00');
    expect(bmd).toContain("'=cmd");
    const datev = datevCsv(j, 2026, { consultant: '', client: '', name: 'Test' });
    expect(datev.split('\r\n')[0]).toMatch(/^"EXTF";700;21;"Buchungsstapel"/);
    expect(datev).toContain('120,00;S;EUR;;;;2800;4000;3;"1004"');
  });
  it('lehnt manipulierte Belegpfade ab', () => {
    const db = setup();
    const e = { ...expense(db, { gross: 100 }), id: 'x', receipts: [{ path: '../../etc/passwd', originalName: 'x', sha256: '', size: 0, addedAt: '' }] };
    expect(() => validateDatabase({ ...db, entries: [e] })).toThrow(/Beleg/);
  });
});
