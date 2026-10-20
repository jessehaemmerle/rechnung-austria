import { yearOf } from '../dates';
import { centsToDecimal, roundCents } from '../money';
import { computeTotals } from '../tax';
import type { AccountMapping, Cents, CompanySettings, Database, VatRate } from '../types';
import { afaForYear } from './assets';
import { categoryById, KM_ALLOWANCE } from './categories';
import { entryAmounts } from './entries';
import { kmAllowanceForYear } from './trips';

/** Steuerart einer Buchungszeile */
export type TaxKind = 'ust' | 'vst' | 'rc' | 'ige' | 'none';

export interface JournalLine {
  date: string;
  receipt: string;
  text: string;
  /** Sollkonto */
  debit: string;
  /** Habenkonto */
  credit: string;
  /** Bruttobetrag (bei RC/ig. Erwerb: netto) */
  amount: Cents;
  tax: Cents;
  rate: VatRate;
  taxKind: TaxKind;
  symbol: 'AR' | 'ER' | 'BK' | 'KA' | 'SO';
}

export const DEFAULT_ACCOUNTS: AccountMapping = {
  bank: '2800',
  cash: '2700',
  revenue20: '4000',
  revenue13: '4013',
  revenue10: '4010',
  revenueExempt: '4020',
  revenueReverseCharge: '4100',
  revenueIgDelivery: '4110',
  expense: {},
};

export function expenseAccount(acc: AccountMapping, categoryId: string): string {
  return acc.expense[categoryId] || categoryById(categoryId).account;
}

function revenueAccount(acc: AccountMapping, rate: VatRate, exemption: string | null): string {
  if (exemption === 'reverse_charge') return acc.revenueReverseCharge;
  if (exemption === 'ig_delivery') return acc.revenueIgDelivery;
  if (exemption === 'small_business' || rate === 0) return acc.revenueExempt;
  return rate === 20 ? acc.revenue20 : rate === 13 ? acc.revenue13 : acc.revenue10;
}

/**
 * Buchungsjournal eines Jahres nach Zahlungsfluss (E/A-Rechnung): Zahlungseingänge,
 * bezahlte Ausgaben, AfA und Kilometergeld. Ausgabe als Grundlage für BMD und DATEV.
 */
export function buildJournal(db: Database, year: number): JournalLine[] {
  const acc = { ...DEFAULT_ACCOUNTS, ...db.settings.accounts, expense: { ...db.settings.accounts?.expense } };
  const lines: JournalLine[] = [];

  for (const d of db.documents) {
    if (d.kind !== 'invoice' || d.status === 'draft') continue;
    const s: CompanySettings = d.companySnapshot ?? db.settings;
    const t = computeTotals(d, s);
    if (!t.gross) continue;
    for (const p of d.payments) {
      if (yearOf(p.date) !== year) continue;
      const factor = p.amount / t.gross;
      for (const g of t.groups) {
        const net = roundCents(g.net * factor);
        const vat = roundCents(g.vat * factor);
        lines.push({
          date: p.date, receipt: d.number, text: `Zahlung ${d.number} ${d.customerSnapshot?.name ?? ''}`.trim(),
          debit: acc.bank, credit: revenueAccount(acc, g.rate, t.exemption), amount: net + vat, tax: vat, rate: g.rate,
          taxKind: vat ? 'ust' : 'none', symbol: 'BK',
        });
      }
    }
  }

  for (const e of db.entries) {
    if (!e.paidDate || yearOf(e.paidDate) !== year) continue;
    const a = entryAmounts(e, db.settings);
    const money = e.paidVia === 'cash' ? acc.cash : acc.bank;
    const symbol = e.paidVia === 'cash' ? 'KA' : 'BK';
    if (e.kind === 'income') {
      lines.push({
        date: e.paidDate, receipt: e.receiptNumber, text: e.description, debit: money, credit: categoryById(e.category).account,
        amount: e.gross, tax: a.vat, rate: e.vatRate, taxKind: a.vat ? 'ust' : 'none', symbol,
      });
      continue;
    }
    const rc = e.taxCase === 'reverse_charge' || e.taxCase === 'ig_acquisition';
    lines.push({
      date: e.paidDate, receipt: e.receiptNumber, text: (e.description.includes(e.counterparty) ? e.description : `${e.counterparty} ${e.description}`).trim().slice(0, 60),
      debit: expenseAccount(acc, e.category), credit: money, amount: e.gross, tax: rc ? a.vat : a.inputTax, rate: e.vatRate,
      taxKind: rc ? (e.taxCase === 'reverse_charge' ? 'rc' : 'ige') : a.inputTax ? 'vst' : 'none', symbol,
    });
  }

  for (const { asset, row } of afaForYear(db.assets, year)) {
    const amount = row.afa + row.disposalLoss;
    if (amount) lines.push({
      date: `${year}-12-31`, receipt: 'AfA', text: `AfA ${asset.name}`.slice(0, 60), debit: asset.lowValue ? '7010' : '7000', credit: '0600',
      amount, tax: 0, rate: 0, taxKind: 'none', symbol: 'SO',
    });
  }
  const km = kmAllowanceForYear(db.trips, year);
  if (km.amount) lines.push({
    date: `${year}-12-31`, receipt: 'KM', text: `Kilometergeld ${km.km} km lt. Fahrtenbuch`, debit: KM_ALLOWANCE.account, credit: '9600',
    amount: km.amount, tax: 0, rate: 0, taxKind: 'none', symbol: 'SO',
  });
  return lines.sort((a, b) => a.date.localeCompare(b.date));
}

function csvCell(v: string): string {
  const s = /^[=+\-@\t\r]/.test(v) && !/^-?\d+([.,]\d+)?$/.test(v) ? `'${v}` : v;
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const de = (c: Cents) => centsToDecimal(c).replace('.', ',');
const dmy = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

/** BMD-Steuercodes: 1 = Umsatzsteuer, 2 = Vorsteuer, 08 = ig. Erwerb, 19 = Reverse Charge */
const BMD_TAX: Record<TaxKind, string> = { ust: '1', vst: '2', ige: '08', rc: '19', none: '' };

/**
 * BMD NTCS Buchungsimport (CSV, Semikolon). Im BMD bei Bedarf die Importvorlage
 * „Buchungen – Standard“ mit diesen Spalten verwenden.
 */
export function bmdCsv(lines: JournalLine[]): string {
  const head = ['satzart', 'konto', 'gkonto', 'belegnr', 'belegdatum', 'buchsymbol', 'buchcode', 'prozent', 'steuercode', 'betrag', 'steuer', 'text'];
  const rows = lines.map((l) =>
    ['0', l.debit, l.credit, l.receipt, dmy(l.date), l.symbol, '1', l.taxKind === 'none' ? '' : String(l.rate), BMD_TAX[l.taxKind], de(l.amount), de(l.tax), l.text]
      .map(csvCell)
      .join(';'),
  );
  return '﻿' + [head.join(';'), ...rows].join('\r\n') + '\r\n';
}

/** DATEV-BU-Schlüssel (SKR-neutral, bitte mit der Kanzlei abstimmen) */
const DATEV_BU: Record<TaxKind, Record<number, string>> = {
  ust: { 20: '3', 13: '2', 10: '2' },
  vst: { 20: '9', 13: '8', 10: '8' },
  rc: { 20: '94', 13: '94', 10: '94' },
  ige: { 20: '19', 13: '18', 10: '18' },
  none: {},
};

/** Textfeld für DATEV: keine Trennzeichen/Zeilenumbrüche, Formeln für Tabellenkalkulationen entschärft */
function datevText(v: string, max: number): string {
  const s = v.replace(/["\r\n;]/g, ' ').slice(0, max);
  return /^[=+\-@\t]/.test(s) ? `'${s}`.slice(0, max) : s;
}

/** DATEV-Format "Buchungsstapel" (EXTF, Version 700) */
export function datevCsv(lines: JournalLine[], year: number, meta: { consultant: string; client: string; name: string }): string {
  const now = new Date();
  const ts = now.toISOString().replace(/[-:T]/g, '').slice(0, 14) + '000';
  const header = [
    '"EXTF"', '700', '21', '"Buchungsstapel"', '13', ts, '', '"RA"', '""', '""', meta.consultant || '1001', meta.client || '1',
    `${year}0101`, '4', `${year}0101`, `${year}1231`, `"${meta.name.replace(/"/g, '').slice(0, 30)}"`, '""', '1', '0', '0', '"EUR"',
  ].join(';');
  const cols = ['Umsatz (ohne Soll/Haben-Kz)', 'Soll/Haben-Kennzeichen', 'WKZ Umsatz', 'Kurs', 'Basis-Umsatz', 'WKZ Basis-Umsatz', 'Konto', 'Gegenkonto (ohne BU-Schlüssel)', 'BU-Schlüssel', 'Belegdatum', 'Belegfeld 1', 'Belegfeld 2', 'Skonto', 'Buchungstext'];
  const rows = lines.map((l) =>
    [de(l.amount), 'S', 'EUR', '', '', '', l.debit, l.credit, DATEV_BU[l.taxKind][l.rate] ?? '', `${l.date.slice(8, 10)}${l.date.slice(5, 7)}`, datevText(l.receipt, 36), '', '', datevText(l.text, 60)]
      .map((v, i) => (i >= 9 && i !== 12 ? `"${v}"` : v))
      .join(';'),
  );
  return [header, cols.join(';'), ...rows].join('\r\n') + '\r\n';
}
