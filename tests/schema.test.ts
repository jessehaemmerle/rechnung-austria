import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cancelInvoice, finalizeDocument, saveDraft } from '../src/core/documents';
import { toCii } from '../src/core/einvoice/cii';
import { toEbInterface } from '../src/core/einvoice/ebinterface';
import { buildModel, type EModel } from '../src/core/einvoice/model';
import { toUbl } from '../src/core/einvoice/ubl';
import type { Database } from '../src/core/types';
import { invoice, item, setup } from './fixtures';

/**
 * Validiert die erzeugten E-Rechnungen gegen die offiziellen XSD-Schemas.
 * Voraussetzung: `scripts/fetch-schemas.sh` wurde ausgeführt und xmllint ist installiert.
 */
const root = path.resolve(__dirname, '../.schemas');
const schemas = {
  ebinterface: path.join(root, 'eb/external/schemas/ebinterface/ebinterface-6.1.xsd'),
  invoice: path.join(root, 'ubl/xsd/maindoc/UBL-Invoice-2.1.xsd'),
  creditNote: path.join(root, 'ubl/xsd/maindoc/UBL-CreditNote-2.1.xsd'),
  cii: path.join(root, 'cii/external/schemas/d16b/data/standard/CrossIndustryInvoice_100pD16B.xsd'),
};
const available = Object.values(schemas).every((f) => fs.existsSync(f));

function validate(xsd: string, xml: string) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'einv-')), 'doc.xml');
  fs.writeFileSync(file, xml);
  try {
    execFileSync('xmllint', ['--noout', '--schema', xsd, file], { stdio: 'pipe' });
  } catch (e) {
    throw new Error(String((e as { stderr?: Buffer }).stderr ?? e));
  }
}

function scenarios(): [string, EModel][] {
  const out: [string, EModel][] = [];
  const make = (name: string, db: Database, overrides = {}) => {
    const d = invoice(db, [item({ description: 'Beratung & <Konzept>', discountPercent: 15, quantity: 2.5 }), item({ vatRate: 13, unit: 'Stk' })], overrides);
    const r = finalizeDocument(saveDraft(db, d), d.id);
    out.push([name, buildModel(r.doc, r.db.settings, r.db.customers[0])]);
    return r;
  };
  const regular = make('Regelbesteuerung', setup());
  make('Kleinunternehmer', setup({ small: true }));
  make('Reverse Charge', setup({ customer: { vatId: 'DE123456789', address: { street: 'Weg 1', zip: '80331', city: 'München', country: 'DE' } } }), { taxCase: 'reverse_charge', serviceDateTo: '2026-03-31', language: 'en' });
  make('ig. Lieferung', setup({ customer: { vatId: 'IT12345678901', address: { street: 'Via 1', zip: '00100', city: 'Roma', country: 'IT' } } }), { taxCase: 'ig_delivery' });
  const storno = cancelInvoice(regular.db, regular.doc.id, '2026-04-01');
  out.push(['Storno', buildModel(storno.doc, storno.db.settings, storno.db.customers[0], regular.doc)]);
  return out;
}

describe.skipIf(!available)('E-Rechnungen gegen offizielle XSD', () => {
  for (const [name, m] of scenarios()) {
    it(`${name}: ebInterface 6.1`, () => expect(() => validate(schemas.ebinterface, toEbInterface(m))).not.toThrow());
    it(`${name}: UBL 2.1 (XRechnung)`, () => expect(() => validate(m.isCredit ? schemas.creditNote : schemas.invoice, toUbl(m))).not.toThrow());
    it(`${name}: CII D16B (Factur-X)`, () => expect(() => validate(schemas.cii, toCii(m))).not.toThrow());
  }
});
