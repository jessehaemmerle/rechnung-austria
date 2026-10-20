import { newId } from '../documents';
import { addPayment, removePayment } from '../documents';
import { openAmount } from '../tax';
import type { Asset, BankAccount, BankTransaction, BankTxLink, Database, Entry, Trip } from '../types';
import { LOW_VALUE_LIMIT } from './assets';
import { entryAmounts } from './entries';
import { mergeTransactions, type ImportedTx } from './bank';

function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  return list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item];
}

function cashAccount(db: Database): BankAccount | undefined {
  return db.bankAccounts.find((a) => a.kind === 'cash');
}

/**
 * Speichert eine Ausgabe/Einnahme. Bei Kategorie "Anlagegut" wird ein Eintrag im
 * Anlagenverzeichnis angelegt bzw. aktualisiert; Barzahlungen erscheinen im Kassabuch.
 */
export function saveEntry(db: Database, input: Entry): { db: Database; entry: Entry } {
  if (!input.date) throw new Error('Belegdatum fehlt.');
  if (!Number.isSafeInteger(input.gross) || input.gross <= 0) throw new Error('Betrag muss größer als 0 sein.');
  if (input.paidDate && input.paidDate < '2000-01-01') throw new Error('Zahlungsdatum ungültig.');
  const existing = db.entries.find((e) => e.id === input.id);
  let entry: Entry = {
    ...input,
    id: input.id || newId(),
    // Belege und Bankverknüpfung werden nur über eigene Funktionen geändert
    receipts: existing?.receipts ?? [],
    bankTransactionId: existing?.bankTransactionId,
    assetId: existing?.assetId,
  };
  // Bei Verknüpfung mit einer Bankbewegung bestimmt die Bank das Zahlungsdatum (Kassabewegungen folgen der Buchung)
  if (entry.bankTransactionId) {
    const tx = db.bankTransactions.find((t) => t.id === entry.bankTransactionId);
    if (tx && tx.accountId !== cashAccount(db)?.id) entry = { ...entry, paidDate: tx.date, paidVia: 'bank' };
  }
  let next: Database = { ...db, entries: upsert(db.entries, entry) };

  // Anlagenverzeichnis
  if (entry.kind === 'expense' && isAssetCategory(entry.category)) {
    const a = entryAmounts(entry, db.settings);
    const cost = a.inputTax ? a.net : entry.gross;
    const prev = next.assets.find((x) => x.id === entry.assetId);
    const asset: Asset = {
      id: prev?.id ?? newId(),
      name: entry.description || entry.counterparty,
      acquisitionDate: entry.date,
      inServiceDate: prev?.inServiceDate || entry.date,
      cost,
      usefulLifeYears: prev?.usefulLifeYears ?? (entry.category === 'car_asset' ? 8 : 3),
      lowValue: prev ? prev.lowValue && cost <= LOW_VALUE_LIMIT : cost <= LOW_VALUE_LIMIT,
      disposalDate: prev?.disposalDate ?? '',
      disposalProceeds: prev?.disposalProceeds ?? 0,
      disposalVatRate: prev?.disposalVatRate ?? (db.settings.isSmallBusiness ? 0 : 20),
      businessUsePercent: prev?.businessUsePercent ?? 100,
      entryId: entry.id,
      notes: prev?.notes ?? '',
    };
    entry = { ...entry, assetId: asset.id };
    next = { ...next, assets: upsert(next.assets, asset), entries: upsert(next.entries, entry) };
  } else if (entry.assetId) {
    next = { ...next, assets: next.assets.filter((x) => x.id !== entry.assetId) };
    entry = { ...entry, assetId: undefined };
    next = { ...next, entries: upsert(next.entries, entry) };
  }

  // Kassabuch: Barzahlungen als Kassabewegung spiegeln
  next = syncCash(next, entry);
  return { db: next, entry };
}

function syncCash(db: Database, entry: Entry): Database {
  const cash = cashAccount(db);
  const linked = db.bankTransactions.find((t) => t.link?.type === 'entry' && t.link.entryId === entry.id && t.accountId === cash?.id);
  const wantCash = entry.paidVia === 'cash' && !!entry.paidDate;
  if (!cash || !wantCash) {
    if (!linked) return db;
    return { ...db, bankTransactions: db.bankTransactions.filter((t) => t.id !== linked.id), entries: upsert(db.entries, { ...entry, bankTransactionId: undefined }) };
  }
  const amount = entry.kind === 'expense' ? -entry.gross : entry.gross;
  const tx: BankTransaction = {
    id: linked?.id ?? newId(),
    accountId: cash.id,
    date: entry.paidDate,
    amount,
    counterparty: entry.counterparty,
    counterpartyIban: '',
    purpose: entry.description,
    reference: entry.receiptNumber,
    hash: linked?.hash ?? `cash-${entry.id}`,
    link: { type: 'entry', entryId: entry.id },
    importedAt: linked?.importedAt ?? new Date().toISOString(),
  };
  return { ...db, bankTransactions: upsert(db.bankTransactions, tx), entries: upsert(db.entries, { ...entry, bankTransactionId: tx.id }) };
}

export function deleteEntry(db: Database, id: string): Database {
  const e = db.entries.find((x) => x.id === id);
  if (!e) throw new Error('Buchung nicht gefunden.');
  if (e.receipts.length) throw new Error('Buchungen mit Beleg können nicht gelöscht werden (Aufbewahrungspflicht). Korrigieren Sie stattdessen den Betrag oder die Kategorie.');
  const asset = db.assets.find((a) => a.id === e.assetId);
  if (asset?.disposalDate) throw new Error('Das zugehörige Anlagegut ist bereits ausgeschieden.');
  return {
    ...db,
    entries: db.entries.filter((x) => x.id !== id),
    assets: db.assets.filter((a) => a.id !== e.assetId),
    bankTransactions: db.bankTransactions
      // Kassabewegungen der Buchung entfallen, Bankbewegungen werden nur entkoppelt
      .filter((t) => !(t.link?.type === 'entry' && t.link.entryId === id && t.hash.startsWith('cash-')))
      .map((t) => (t.link?.type === 'entry' && t.link.entryId === id ? { ...t, link: undefined } : t)),
  };
}

export function saveAsset(db: Database, asset: Asset): Database {
  if (!asset.name.trim()) throw new Error('Bezeichnung fehlt.');
  if (!(asset.usefulLifeYears >= 1)) throw new Error('Nutzungsdauer muss mindestens 1 Jahr sein.');
  if (asset.lowValue && asset.cost > LOW_VALUE_LIMIT) throw new Error('Sofortabschreibung als GWG nur bis 1.000 € möglich.');
  if (asset.disposalDate && asset.disposalDate < asset.acquisitionDate) throw new Error('Ausscheiden vor Anschaffung ist nicht möglich.');
  return { ...db, assets: upsert(db.assets, { ...asset, id: asset.id || newId() }) };
}

export function deleteAsset(db: Database, id: string): Database {
  const a = db.assets.find((x) => x.id === id);
  if (a?.entryId) throw new Error('Dieses Anlagegut stammt aus einer Ausgabe – ändern Sie dort die Kategorie.');
  return { ...db, assets: db.assets.filter((x) => x.id !== id) };
}

export function saveTrip(db: Database, trip: Trip): Database {
  if (!trip.date || !trip.purpose.trim() || !(trip.km > 0)) throw new Error('Datum, Zweck und Kilometer sind Pflichtangaben.');
  return { ...db, trips: upsert(db.trips, { ...trip, id: trip.id || newId() }) };
}

export function deleteTrip(db: Database, id: string): Database {
  return { ...db, trips: db.trips.filter((t) => t.id !== id) };
}

export function saveBankAccount(db: Database, acc: BankAccount): Database {
  if (!acc.name.trim()) throw new Error('Name fehlt.');
  if (acc.kind === 'cash' && db.bankAccounts.some((a) => a.kind === 'cash' && a.id !== acc.id)) throw new Error('Es gibt bereits eine Kassa.');
  return { ...db, bankAccounts: upsert(db.bankAccounts, { ...acc, id: acc.id || newId() }) };
}

export function deleteBankAccount(db: Database, id: string): Database {
  if (db.bankTransactions.some((t) => t.accountId === id)) throw new Error('Konto hat Bewegungen und kann nicht gelöscht werden.');
  return { ...db, bankAccounts: db.bankAccounts.filter((a) => a.id !== id) };
}

export function importTransactions(db: Database, accountId: string, txs: ImportedTx[]): { db: Database; added: number; duplicates: number } {
  if (!db.bankAccounts.some((a) => a.id === accountId)) throw new Error('Konto nicht gefunden.');
  const { added, duplicates } = mergeTransactions(db.bankTransactions, accountId, txs, newId);
  return { db: { ...db, bankTransactions: [...db.bankTransactions, ...added] }, added: added.length, duplicates };
}

export function isAssetCategory(category: string): boolean {
  return category === 'asset' || category === 'car_asset';
}

function getTx(db: Database, id: string): BankTransaction {
  const tx = db.bankTransactions.find((t) => t.id === id);
  if (!tx) throw new Error('Bankbewegung nicht gefunden.');
  return tx;
}

function setLink(db: Database, txId: string, link: BankTxLink | undefined): Database {
  return { ...db, bankTransactions: db.bankTransactions.map((t) => (t.id === txId ? { ...t, link } : t)) };
}

/** Bankeingang als Zahlung einer Ausgangsrechnung verbuchen */
export function linkToInvoice(db: Database, txId: string, documentId: string): Database {
  const tx = getTx(db, txId);
  if (tx.link) throw new Error('Bewegung ist bereits zugeordnet.');
  if (tx.amount <= 0) throw new Error('Nur Eingänge können Rechnungen zugeordnet werden.');
  const doc = db.documents.find((d) => d.id === documentId);
  if (!doc) throw new Error('Rechnung nicht gefunden.');
  const open = openAmount(doc, doc.companySnapshot ?? db.settings);
  if (tx.amount > open) throw new Error('Der Betrag ist höher als der offene Rechnungsbetrag.');
  const next = addPayment(db, documentId, { date: tx.date, amount: tx.amount, note: `Bank: ${tx.counterparty}`.slice(0, 120) });
  const updated = next.documents.find((d) => d.id === documentId)!;
  const payment = updated.payments[updated.payments.length - 1];
  return setLink(next, txId, { type: 'invoice', documentId, paymentId: payment.id });
}

/** Bankbewegung mit einer erfassten Ausgabe/Einnahme verknüpfen (setzt Zahlungsdatum) */
export function linkToEntry(db: Database, txId: string, entryId: string): Database {
  const tx = getTx(db, txId);
  if (tx.link) throw new Error('Bewegung ist bereits zugeordnet.');
  const e = db.entries.find((x) => x.id === entryId);
  if (!e) throw new Error('Buchung nicht gefunden.');
  if (e.bankTransactionId) throw new Error('Buchung ist bereits mit einer Bewegung verknüpft.');
  if ((e.kind === 'expense') !== tx.amount < 0) throw new Error('Richtung passt nicht (Eingang/Ausgang).');
  const entry: Entry = { ...e, paidDate: tx.date, paidVia: 'bank', bankTransactionId: tx.id };
  return setLink({ ...db, entries: upsert(db.entries, entry) }, txId, { type: 'entry', entryId });
}

/** Aus einer Bankbewegung direkt eine Ausgabe/Einnahme anlegen */
export function entryFromTransaction(db: Database, txId: string, template: Entry): { db: Database; entry: Entry } {
  const tx = getTx(db, txId);
  if (tx.link) throw new Error('Bewegung ist bereits zugeordnet.');
  // Zahlungen auf eigene Rechnungen dürfen nicht zusätzlich als Einnahme zählen
  if (tx.amount > 0) {
    const text = `${tx.purpose} ${tx.reference}`.toLowerCase().replace(/[^a-z0-9]/g, '');
    const inv = db.documents.find((d) => d.kind === 'invoice' && d.status !== 'draft' && d.number && text.includes(d.number.toLowerCase().replace(/[^a-z0-9]/g, '')));
    if (inv) throw new Error(`Diese Zahlung betrifft Rechnung ${inv.number} – bitte der Rechnung zuordnen statt als Einnahme zu buchen.`);
  }
  const res = saveEntry(db, {
    ...template,
    id: '',
    kind: tx.amount < 0 ? 'expense' : 'income',
    gross: Math.abs(tx.amount),
    paidDate: tx.date,
    paidVia: 'bank',
    date: template.date || tx.date,
    counterparty: template.counterparty || tx.counterparty,
    description: template.description || tx.purpose.slice(0, 120),
  });
  const linked = linkToEntry(res.db, txId, res.entry.id);
  return { db: linked, entry: linked.entries.find((e) => e.id === res.entry.id)! };
}

/** Privatentnahme/-einlage, Umbuchung, Steuerzahlung oder ignorieren – erfolgsneutral */
export function markTransaction(db: Database, txId: string, type: 'private' | 'transfer' | 'tax' | 'ignored'): Database {
  const tx = getTx(db, txId);
  if (tx.link) throw new Error('Bewegung ist bereits zugeordnet.');
  return setLink(db, txId, { type });
}

/** Zuordnung aufheben (inkl. der dabei erfassten Zahlung) */
export function unlinkTransaction(db: Database, txId: string): Database {
  const tx = getTx(db, txId);
  if (!tx.link) return db;
  if (tx.hash.startsWith('cash-')) throw new Error('Kassabewegungen werden über die Buchung geändert.');
  let next = db;
  if (tx.link.type === 'invoice') next = removePayment(next, tx.link.documentId, tx.link.paymentId);
  if (tx.link.type === 'entry') {
    const id = tx.link.entryId;
    next = { ...next, entries: next.entries.map((e) => (e.id === id ? { ...e, paidDate: '', paidVia: '' as const, bankTransactionId: undefined } : e)) };
  }
  return setLink(next, txId, undefined);
}

/** Manuelle Kassabewegung ohne Beleg-Buchung (z. B. Bareinlage, Abhebung) */
export function addCashMovement(db: Database, m: { date: string; amount: number; purpose: string; type: 'private' | 'transfer' }): Database {
  const cash = cashAccount(db);
  if (!cash) throw new Error('Legen Sie zuerst eine Kassa an.');
  if (!m.date || !m.amount) throw new Error('Datum und Betrag fehlen.');
  const tx: BankTransaction = {
    id: newId(), accountId: cash.id, date: m.date, amount: m.amount, counterparty: '', counterpartyIban: '',
    purpose: m.purpose, reference: '', hash: `cashm-${newId()}`, link: { type: m.type }, importedAt: new Date().toISOString(),
  };
  return { ...db, bankTransactions: [...db.bankTransactions, tx] };
}
