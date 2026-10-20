import { yearOf } from '../dates';
import { roundCents } from '../money';
import { computeTotals } from '../tax';
import type { BusinessDocument, Cents, CompanySettings, Database } from '../types';
import { afaForYear } from './assets';
import { CATEGORIES, categoryById, KM_ALLOWANCE } from './categories';
import { entryAmounts } from './entries';
import { kmAllowanceForYear } from './trips';
import { isAssetCategory } from './ledger';

export interface EarLine {
  e1a: string;
  label: string;
  amount: Cents;
}

export interface EarReport {
  year: number;
  income: EarLine[];
  expenses: EarLine[];
  totalIncome: Cents;
  totalExpenses: Cents;
  /** Gewinn vor Gewinnfreibetrag */
  profit: Cents;
  /** Grundfreibetrag (§ 10 EStG): 15 % von bis zu 33.000 € Gewinn */
  basicAllowance: Cents;
  taxableProfit: Cents;
  /** Im Jahr bezahlte eigene SVS-Beiträge (für die Beitragsgrundlage) */
  svsPaid: Cents;
  warnings: string[];
}

export const BASIC_ALLOWANCE_RATE = 0.15;
export const BASIC_ALLOWANCE_BASE: Cents = 3_300_000;

const settingsOf = (db: Database, d: BusinessDocument): CompanySettings => d.companySnapshot ?? db.settings;

/**
 * Einnahmen-Ausgaben-Rechnung nach § 4 Abs 3 EStG (Zufluss-/Abflussprinzip, Nettosystem):
 * Einnahmen zählen bei Zahlungseingang, Ausgaben bei Bezahlung. Anlagegüter wirken über die AfA.
 * Die Umsatzsteuer ist im Nettosystem erfolgsneutral; Kleinunternehmer buchen brutto.
 */
export function earReport(db: Database, year: number): EarReport {
  const income = new Map<string, EarLine>();
  const expenses = new Map<string, EarLine>();
  const warnings: string[] = [];
  const add = (map: Map<string, EarLine>, e1a: string, label: string, amount: Cents) => {
    const key = `${e1a}|${label}`;
    const cur = map.get(key) ?? { e1a, label, amount: 0 };
    cur.amount += amount;
    map.set(key, cur);
  };

  // Zahlungseingänge auf Ausgangsrechnungen (netto bzw. brutto bei Kleinunternehmern)
  // Rückzahlungen auf Stornorechnungen mindern die Erlöse (Gutschrift: negative Summen)
  for (const d of db.documents) {
    if (d.kind === 'offer' || d.status === 'draft') continue;
    const t = computeTotals(d, settingsOf(db, d));
    for (const p of d.payments) {
      if (yearOf(p.date) !== year || !t.gross) continue;
      const net = roundCents((t.net * p.amount) / Math.abs(t.gross));
      add(income, '9040', 'Erlöse aus Lieferungen und Leistungen', net);
    }
  }

  let svsPaid = 0;
  for (const e of db.entries) {
    if (!e.paidDate || yearOf(e.paidDate) !== year) continue;
    const cat = categoryById(e.category);
    const a = entryAmounts(e, db.settings);
    if (e.kind === 'income') {
      add(income, cat.e1a, cat.e1aLabel, a.incomeTaxAmount);
      continue;
    }
    if (isAssetCategory(e.category)) continue; // wirkt über das Anlagenverzeichnis
    if (e.category === 'svs') svsPaid += a.incomeTaxAmount;
    add(expenses, cat.e1a, cat.e1aLabel, a.incomeTaxAmount);
  }
  for (const e of db.entries) {
    if (e.kind === 'expense' && isAssetCategory(e.category) && !e.assetId)
      warnings.push(`Anlagegut „${e.description || e.counterparty}“ ist noch nicht im Anlagenverzeichnis.`);
  }

  for (const { asset, row } of afaForYear(db.assets, year)) {
    if (row.afa) add(expenses, '9130', asset.lowValue ? 'Geringwertige Wirtschaftsgüter' : 'Abschreibungen auf das Anlagevermögen', row.afa);
    if (row.disposalLoss) add(expenses, '9130', 'Restbuchwert ausgeschiedener Anlagen', row.disposalLoss);
    if (asset.disposalDate && yearOf(asset.disposalDate) === year && asset.disposalProceeds) {
      // Kleinunternehmer erfassen brutto = netto (keine USt)
      add(income, '9090', 'Erlöse aus dem Verkauf von Anlagen', asset.disposalProceeds);
      if (db.entries.some((e) => e.kind === 'income' && e.paidDate && yearOf(e.paidDate) === year && e.gross >= asset.disposalProceeds && e.description.toLowerCase().includes(asset.name.toLowerCase().slice(0, 10))))
        warnings.push(`Verkauf von „${asset.name}“ ist im Anlagenverzeichnis erfasst – eine zusätzliche Einnahmenbuchung würde doppelt zählen.`);
    }
  }

  const km = kmAllowanceForYear(db.trips, year);
  if (km.amount) add(expenses, KM_ALLOWANCE.e1a, 'Kilometergeld lt. Fahrtenbuch', km.amount);
  if (km.cappedKm) warnings.push(`Kilometergeld ist mit 30.000 km pro Jahr begrenzt – ${km.cappedKm} km wurden nicht berücksichtigt.`);

  const order = (a: EarLine, b: EarLine) => a.e1a.localeCompare(b.e1a) || a.label.localeCompare(b.label);
  const incomeLines = [...income.values()].sort(order);
  const expenseLines = [...expenses.values()].sort(order);
  const totalIncome = incomeLines.reduce((s, l) => s + l.amount, 0);
  const totalExpenses = expenseLines.reduce((s, l) => s + l.amount, 0);
  const profit = totalIncome - totalExpenses;
  const basicAllowance = profit > 0 ? roundCents(Math.min(profit, BASIC_ALLOWANCE_BASE) * BASIC_ALLOWANCE_RATE) : 0;
  return {
    year,
    income: incomeLines,
    expenses: expenseLines,
    totalIncome,
    totalExpenses,
    profit,
    basicAllowance,
    taxableProfit: profit - basicAllowance,
    svsPaid,
    warnings,
  };
}

/** Summen je E1a-Kennzahl (für die Übertragung ins Formular) */
export function e1aSummary(r: EarReport): EarLine[] {
  const map = new Map<string, EarLine>();
  for (const l of [...r.income, ...r.expenses]) {
    const label = CATEGORIES.find((c) => c.e1a === l.e1a)?.e1aLabel ?? l.label;
    const cur = map.get(l.e1a) ?? { e1a: l.e1a, label, amount: 0 };
    cur.amount += l.amount;
    map.set(l.e1a, cur);
  }
  return [...map.values()].sort((a, b) => a.e1a.localeCompare(b.e1a));
}
