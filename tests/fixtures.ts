import { emptyDatabase } from '../src/core/defaults';
import type { BusinessDocument, Customer, Database, LineItem } from '../src/core/types';

export function seller(db: Database, overrides: Partial<Database['settings']> = {}): Database {
  return {
    ...db,
    settings: {
      ...db.settings,
      name: 'Muster EPU',
      owner: 'Maria Muster',
      address: { street: 'Hauptstraße 1', zip: '1010', city: 'Wien', country: 'AT' },
      email: 'office@muster.at',
      iban: 'AT611904300234573201',
      bic: 'BKAUATWW',
      ...overrides,
    },
  };
}

export function customer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 'c1',
    number: 'K-001',
    name: 'Kunde GmbH',
    contactPerson: '',
    address: { street: 'Ring 2', zip: '8010', city: 'Graz', country: 'AT' },
    email: 'buchhaltung@kunde.at',
    vatId: '',
    isBusiness: true,
    language: 'de',
    buyerReference: '',
    notes: '',
    ...overrides,
  };
}

export function item(overrides: Partial<LineItem> = {}): LineItem {
  return { id: 'i' + Math.random(), description: 'Beratung', quantity: 1, unit: 'h', unitPrice: 10000, discountPercent: 0, vatRate: 20, ...overrides };
}

export function setup(opts: { small?: boolean; customer?: Partial<Customer> } = {}): Database {
  const db = seller(emptyDatabase(), { isSmallBusiness: opts.small ?? false, vatId: opts.small ? '' : 'ATU12345678', taxNumber: opts.small ? '12 345/6789' : '' });
  return { ...db, customers: [customer(opts.customer)] };
}

export function invoice(db: Database, items: LineItem[], overrides: Partial<BusinessDocument> = {}): BusinessDocument {
  return {
    id: 'd' + Math.random(),
    kind: 'invoice',
    status: 'draft',
    number: '',
    customerId: db.customers[0]?.id ?? '',
    issueDate: '2026-03-10',
    serviceDateFrom: '2026-03-01',
    serviceDateTo: '',
    dueDate: '2026-03-24',
    validUntil: '',
    taxCase: 'domestic',
    language: 'de',
    title: '',
    introText: '',
    closingText: '',
    items,
    payments: [],
    dunning: [],
    createdAt: '2026-03-10T10:00:00Z',
    ...overrides,
  };
}
