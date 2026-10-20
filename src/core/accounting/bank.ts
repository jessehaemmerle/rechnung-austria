import { roundCents } from '../money';
import { openAmount } from '../tax';
import type { BankTransaction, Cents, Database } from '../types';

export type ImportedTx = Omit<BankTransaction, 'id' | 'accountId' | 'hash' | 'importedAt' | 'link'>;

/** CSV mit Anführungszeichen und automatisch erkanntem Trennzeichen parsen */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [';', ',', '\t'].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows.map((r) => r.map((c) => c.trim()));
}

/** "+1.234,56", "-12,00", "1234.56", "1,234.56" → Cent */
export function parseAmount(s: string): Cents {
  let v = s.replace(/[€\sA-Za-z]/g, '');
  const lastComma = v.lastIndexOf(',');
  const lastDot = v.lastIndexOf('.');
  if (lastComma > lastDot) v = v.replace(/\./g, '').replace(',', '.');
  else v = v.replace(/,/g, '');
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Betrag nicht lesbar: ${s}`);
  return roundCents(n * 100);
}

/** "31.12.2026", "31.12.26", "2026-12-31", "2026-12-31T10:00" → "2026-12-31" */
export function parseDate(s: string): string {
  const t = s.trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  throw new Error(`Datum nicht lesbar: ${s}`);
}

export interface ColumnMapping {
  hasHeader: boolean;
  date: number;
  amount: number;
  counterparty: number;
  iban: number;
  purpose: number[];
  reference: number;
}

export type BankFormat = 'george' | 'elba' | 'generic';

const find = (header: string[], re: RegExp) => header.findIndex((h) => re.test(h.toLowerCase()));

/**
 * Erkennt das Format und schlägt eine Spaltenzuordnung vor.
 * - ELBA (Raiffeisen): ohne Kopfzeile, Spalten Datum;Text;Valuta;Betrag;Währung;Zeitstempel
 * - George (Erste/Sparkasse) und andere: Kopfzeile mit Spaltennamen
 */
export function detectMapping(rows: string[][]): { format: BankFormat; mapping: ColumnMapping } {
  const first = rows[0] ?? [];
  const looksLikeData = first.length >= 4 && /^\d{1,2}\.\d{1,2}\.\d{2,4}$/.test(first[0]) && /^[+-]?[\d.]+,\d{2}$/.test(first[3] ?? '');
  if (looksLikeData) {
    return { format: 'elba', mapping: { hasHeader: false, date: 0, amount: 3, counterparty: -1, iban: -1, purpose: [1], reference: -1 } };
  }
  const h = first;
  const george = h.some((x) => /partnername|partner name/i.test(x));
  const purpose = [find(h, /verwendungszweck|purpose|buchungstext|^text$|details|beschreibung|zahlungsgrund/), find(h, /zusatzinformation|additional|notiz/)].filter((i) => i >= 0);
  return {
    format: george ? 'george' : 'generic',
    mapping: {
      hasHeader: true,
      date: Math.max(0, find(h, /buchungsdatum|booking date|^datum$|date|valuta/)),
      amount: Math.max(0, find(h, /^betrag|amount|umsatz/)),
      counterparty: find(h, /partnername|partner name|auftraggeber|empfänger|zahlungspflichtiger|name/),
      iban: find(h, /partner iban|iban|kontonummer/),
      purpose,
      reference: find(h, /zahlungsreferenz|reference|referenz/),
    },
  };
}

export function applyMapping(rows: string[][], m: ColumnMapping): { txs: ImportedTx[]; errors: string[] } {
  const txs: ImportedTx[] = [];
  const errors: string[] = [];
  (m.hasHeader ? rows.slice(1) : rows).forEach((r, i) => {
    try {
      const purpose = m.purpose.map((p) => r[p] ?? '').filter(Boolean).join(' ');
      let counterparty = m.counterparty >= 0 ? r[m.counterparty] ?? '' : '';
      // ELBA hat keine eigene Spalte für den Partner; der Text beginnt meist damit.
      if (!counterparty && purpose) counterparty = purpose.split(/\s{2,}|\|/)[0].slice(0, 80);
      txs.push({
        date: parseDate(r[m.date] ?? ''),
        amount: parseAmount(r[m.amount] ?? ''),
        counterparty,
        counterpartyIban: m.iban >= 0 ? (r[m.iban] ?? '').replace(/\s/g, '') : '',
        purpose,
        reference: m.reference >= 0 ? r[m.reference] ?? '' : '',
      });
    } catch (e) {
      errors.push(`Zeile ${i + 1 + (m.hasHeader ? 1 : 0)}: ${(e as Error).message}`);
    }
  });
  return { txs, errors };
}

const tag = (xml: string, path: string): string => {
  let cur = xml;
  for (const t of path.split('/')) {
    const m = cur.match(new RegExp(`<(?:\\w+:)?${t}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${t}>`));
    if (!m) return '';
    cur = m[1];
  }
  return cur.trim();
};
const unescapeXml = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** SEPA-Kontoauszug camt.053 (ISO 20022) */
export function parseCamt053(xml: string): ImportedTx[] {
  if (xml.length > 10_000_000) throw new Error('Datei zu groß.');
  const entries = xml.match(/<(?:\w+:)?Ntry>[\s\S]*?<\/(?:\w+:)?Ntry>/g) ?? [];
  if (entries.length > 20_000) throw new Error('Zu viele Buchungen in einer Datei.');
  return entries.map((n) => {
    const amount = parseAmount(tag(n, 'Amt'));
    const credit = tag(n, 'CdtDbtInd') === 'CRDT';
    const date = parseDate(tag(n, 'BookgDt/Dt') || tag(n, 'BookgDt/DtTm') || tag(n, 'ValDt/Dt'));
    // Bei Gutschriften ist der Zahler (Dbtr) der Partner, bei Lastschriften der Empfänger (Cdtr).
    const party = credit ? 'Dbtr' : 'Cdtr';
    const partyName = tag(n, `RltdPties/${party}/Nm`) || tag(n, `RltdPties/${party}/Pty/Nm`);
    const iban = tag(n, `RltdPties/${party}Acct/Id/IBAN`);
    const ustrd = (n.match(/<(?:\w+:)?Ustrd>([\s\S]*?)<\/(?:\w+:)?Ustrd>/g) ?? []).map((u) => u.replace(/<[^>]+>/g, '')).join(' ');
    return {
      date,
      amount: credit ? amount : -amount,
      counterparty: unescapeXml(partyName),
      counterpartyIban: iban,
      purpose: unescapeXml(ustrd || tag(n, 'AddtlNtryInf')),
      reference: unescapeXml(tag(n, 'CdtrRefInf/Ref') || tag(n, 'EndToEndId')),
    };
  });
}

export function txHash(t: ImportedTx, occurrence: number): string {
  const s = `${t.date}|${t.amount}|${t.counterparty}|${t.purpose}|${t.reference}|${occurrence}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36) + s.length.toString(36);
}

/** Fügt neue Bewegungen hinzu und überspringt bereits importierte (gleicher Prüfwert). */
export function mergeTransactions(existing: BankTransaction[], accountId: string, incoming: ImportedTx[], newId: () => string) {
  const known = new Set(existing.filter((t) => t.accountId === accountId).map((t) => t.hash));
  const seen = new Map<string, number>();
  const added: BankTransaction[] = [];
  let duplicates = 0;
  for (const t of incoming) {
    const base = `${t.date}|${t.amount}|${t.counterparty}|${t.purpose}|${t.reference}`;
    const occ = (seen.get(base) ?? 0) + 1;
    seen.set(base, occ);
    const hash = txHash(t, occ);
    if (known.has(hash)) { duplicates++; continue; }
    added.push({ ...t, id: newId(), accountId, hash, importedAt: new Date().toISOString() });
  }
  return { added, duplicates };
}

export interface MatchSuggestion {
  type: 'invoice' | 'entry';
  id: string;
  label: string;
  score: number;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Vorschläge für die Zuordnung einer Bankbewegung: Eingänge zu offenen Rechnungen
 * (Betrag und/oder Rechnungsnummer im Verwendungszweck), Ausgänge zu offenen Ausgaben.
 */
export function suggestMatches(db: Database, tx: BankTransaction): MatchSuggestion[] {
  const text = norm(`${tx.purpose} ${tx.reference} ${tx.counterparty}`);
  const out: MatchSuggestion[] = [];
  if (tx.amount > 0) {
    for (const d of db.documents) {
      if (d.kind !== 'invoice' || d.status !== 'final') continue;
      const open = openAmount(d, d.companySnapshot ?? db.settings);
      if (open <= 0) continue;
      let score = 0;
      if (d.number && text.includes(norm(d.number))) score += 60;
      if (open === tx.amount) score += 35;
      const name = norm(d.customerSnapshot?.name ?? '');
      if (name.length > 3 && text.includes(name.slice(0, 12))) score += 15;
      if (score >= 35) out.push({ type: 'invoice', id: d.id, label: `${d.number} · ${d.customerSnapshot?.name ?? ''}`, score });
    }
  } else {
    for (const e of db.entries) {
      if (e.kind !== 'expense' || e.paidDate || e.bankTransactionId) continue;
      let score = 0;
      if (e.gross === -tx.amount) score += 50;
      const cp = norm(e.counterparty);
      if (cp.length > 3 && text.includes(cp.slice(0, 12))) score += 30;
      if (e.receiptNumber && text.includes(norm(e.receiptNumber))) score += 30;
      if (score >= 50) out.push({ type: 'entry', id: e.id, label: `${e.counterparty || e.description} · ${e.receiptNumber}`, score });
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 5);
}

export function accountBalance(db: Database, accountId: string, untilIso = '9999-12-31'): Cents {
  const acc = db.bankAccounts.find((a) => a.id === accountId);
  if (!acc) return 0;
  return acc.openingBalance + db.bankTransactions.filter((t) => t.accountId === accountId && t.date <= untilIso).reduce((s, t) => s + t.amount, 0);
}

/** Kassabuch: Tage, an denen der Kassastand negativ wäre (formeller Mangel) */
export function negativeCashDays(db: Database, accountId: string): string[] {
  const acc = db.bankAccounts.find((a) => a.id === accountId);
  if (!acc) return [];
  let bal = acc.openingBalance;
  const days: string[] = [];
  const txs = db.bankTransactions.filter((t) => t.accountId === accountId).sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 0; i < txs.length; i++) {
    bal += txs[i].amount;
    if ((i === txs.length - 1 || txs[i + 1].date !== txs[i].date) && bal < 0) days.push(txs[i].date);
  }
  return days;
}
