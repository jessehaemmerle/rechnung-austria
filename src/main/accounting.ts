import { createHash, randomUUID } from 'node:crypto';
import { dialog, shell, type BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { ImportedTx } from '../core/accounting/bank';
import { bmdCsv, buildJournal, datevCsv } from '../core/accounting/export';
import {
  addCashMovement, deleteAsset, deleteBankAccount, deleteEntry, deleteTrip, entryFromTransaction, importTransactions, linkToEntry,
  linkToInvoice, markTransaction, saveAsset, saveBankAccount, saveEntry, saveTrip, unlinkTransaction,
} from '../core/accounting/ledger';
import { renderAssetsHtml, renderCashBookHtml, renderEarHtml, renderTripsHtml, renderUvaHtml } from '../core/accounting/reportTemplate';
import { periodsOfYear } from '../core/accounting/vat';
import type { Asset, BankAccount, Database, Entry, Receipt, Trip } from '../core/types';
import type { AccountingReport } from '../preload/api';
import { validateDatabase } from '../core/defaults';
import { htmlToPdf } from './pdf';
import type { Store } from './store';

type Handle = (channel: string, fn: (...args: any[]) => unknown) => void;

const MAX_RECEIPT_BYTES = 25 * 1024 * 1024;
// Keine XML-Dateien: würden vom Betriebssystem ggf. im Browser mit aktiven Inhalten geöffnet
const RECEIPT_EXT = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.heic']);

/** Prüft eine Buchung aus der Oberfläche mit denselben Regeln wie den Datenimport. */
function validEntry(raw: Entry, db: Database): Entry {
  const existing = db.entries.find((e) => e.id === raw.id);
  const entry: Entry = { ...raw, receipts: existing?.receipts ?? [] };
  validateDatabase({ ...db, entries: [entry] });
  return entry;
}

function validTxs(raw: unknown): ImportedTx[] {
  if (!Array.isArray(raw) || raw.length > 20_000) throw new Error('Ungültige Importdaten.');
  return raw.map((t) => {
    const ok =
      t && /^\d{4}-\d{2}-\d{2}$/.test(t.date) && Number.isSafeInteger(t.amount) &&
      ['counterparty', 'counterpartyIban', 'purpose', 'reference'].every((k) => typeof t[k] === 'string' && t[k].length < 2000);
    if (!ok) throw new Error('Ungültige Bankbewegung im Import.');
    return { date: t.date, amount: t.amount, counterparty: t.counterparty, counterpartyIban: t.counterpartyIban, purpose: t.purpose, reference: t.reference };
  });
}

export function registerAccountingIpc(handle: Handle, store: Store, win: () => BrowserWindow | null) {
  const mutate = <T>(fn: (db: Database) => { db: Database; result: T }) => store.update(fn);
  const save = async (name: string, data: string | Uint8Array, filters: Electron.FileFilter[]) => {
    const res = await dialog.showSaveDialog(win()!, { defaultPath: name, filters });
    if (res.canceled || !res.filePath) return null;
    fs.writeFileSync(res.filePath, data);
    return res.filePath;
  };

  handle('entry:save', (e: Entry) => mutate((db) => {
    const r = saveEntry(db, validEntry(e, db));
    return { db: r.db, result: r.entry };
  }));
  handle('entry:delete', (id: string) => mutate((db) => ({ db: deleteEntry(db, id), result: true })));

  // Belege werden mit Prüfsumme in den Datenordner kopiert und danach nicht mehr verändert.
  handle('entry:attachReceipt', async (entryId: string) => {
    const entry = store.get().entries.find((e) => e.id === entryId);
    if (!entry) throw new Error('Buchung nicht gefunden – bitte zuerst speichern.');
    const res = await dialog.showOpenDialog(win()!, {
      title: 'Beleg auswählen',
      filters: [{ name: 'Belege', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'heic'] }],
      properties: ['openFile', 'multiSelections'],
    });
    if (res.canceled || !res.filePaths.length) return false;
    const y = entry.date.slice(0, 4);
    const year = /^\d{4}$/.test(y) ? y : new Date().toISOString().slice(0, 4);
    const dir = path.join(store.dataDir, 'belege', year);
    fs.mkdirSync(dir, { recursive: true });
    const receipts: Receipt[] = res.filePaths.map((src) => {
      const ext = path.extname(src).toLowerCase();
      if (!RECEIPT_EXT.has(ext)) throw new Error(`Dateityp nicht erlaubt: ${ext}`);
      const stat = fs.statSync(src);
      if (stat.size > MAX_RECEIPT_BYTES) throw new Error(`${path.basename(src)} ist größer als 25 MB.`);
      const buf = fs.readFileSync(src);
      const rel = `belege/${year}/${randomUUID()}${ext}`;
      fs.writeFileSync(path.join(store.dataDir, rel), buf, { flag: 'wx' });
      return { path: rel, originalName: path.basename(src).slice(0, 200), sha256: createHash('sha256').update(buf).digest('hex'), size: buf.length, addedAt: new Date().toISOString() };
    });
    return mutate((db) => ({
      db: { ...db, entries: db.entries.map((e) => (e.id === entryId ? { ...e, receipts: [...e.receipts, ...receipts] } : e)) },
      result: true,
    }));
  });
  handle('entry:openReceipt', async (entryId: string, index: number) => {
    const r = store.get().entries.find((e) => e.id === entryId)?.receipts[index];
    if (!r) throw new Error('Beleg nicht gefunden.');
    const full = path.resolve(store.dataDir, r.path);
    if (!full.startsWith(path.resolve(store.dataDir, 'belege') + path.sep)) throw new Error('Ungültiger Belegpfad.');
    const hash = createHash('sha256').update(fs.readFileSync(full)).digest('hex');
    if (hash !== r.sha256) throw new Error('Prüfsumme stimmt nicht – die Belegdatei wurde verändert.');
    const err = await shell.openPath(full);
    if (err) throw new Error(err);
    return true;
  });

  handle('asset:save', (a: Asset) => mutate((db) => ({ db: saveAsset(db, a), result: true })));
  handle('asset:delete', (id: string) => mutate((db) => ({ db: deleteAsset(db, id), result: true })));
  handle('trip:save', (t: Trip) => mutate((db) => ({ db: saveTrip(db, t), result: true })));
  handle('trip:delete', (id: string) => mutate((db) => ({ db: deleteTrip(db, id), result: true })));
  handle('account:save', (a: BankAccount) => mutate((db) => ({ db: saveBankAccount(db, a), result: true })));
  handle('account:delete', (id: string) => mutate((db) => ({ db: deleteBankAccount(db, id), result: true })));

  handle('bank:import', (accountId: string, txs: unknown) => mutate((db) => {
    const r = importTransactions(db, accountId, validTxs(txs));
    return { db: r.db, result: { added: r.added, duplicates: r.duplicates } };
  }));
  handle('bank:linkInvoice', (txId: string, docId: string) => mutate((db) => ({ db: linkToInvoice(db, txId, docId), result: true })));
  handle('bank:linkEntry', (txId: string, entryId: string) => mutate((db) => ({ db: linkToEntry(db, txId, entryId), result: true })));
  handle('bank:createEntry', (txId: string, template: Entry) => mutate((db) => {
    const r = entryFromTransaction(db, txId, validEntry({ ...template, id: '', gross: Math.max(1, template.gross || 1) }, db));
    return { db: r.db, result: r.entry };
  }));
  handle('bank:mark', (txId: string, type: 'private' | 'transfer' | 'tax' | 'ignored') => mutate((db) => ({ db: markTransaction(db, txId, type), result: true })));
  handle('bank:unlink', (txId: string) => mutate((db) => ({ db: unlinkTransaction(db, txId), result: true })));
  handle('cash:add', (m: { date: string; amount: number; purpose: string; type: 'private' | 'transfer' }) =>
    mutate((db) => ({ db: addCashMovement(db, m), result: true })));

  handle('export:bmd', (year: number) => save(`BMD_Buchungen_${year}.csv`, bmdCsv(buildJournal(store.get(), year)), [{ name: 'CSV', extensions: ['csv'] }]));
  handle('export:datev', (year: number, meta: { consultant: string; client: string }) => {
    const db = store.get();
    return save(`EXTF_Buchungsstapel_${year}.csv`, datevCsv(buildJournal(db, year), year, { ...meta, name: db.settings.name }), [{ name: 'CSV', extensions: ['csv'] }]);
  });
  handle('export:accountingPdf', async (report: AccountingReport, year: number, periodIndex?: number) => {
    const db = store.get();
    let html: string;
    let name: string;
    if (report === 'uva') {
      const p = periodsOfYear(year, db.settings.vatPeriod).find((x) => x.index === periodIndex);
      if (!p) throw new Error('Zeitraum nicht gefunden.');
      html = renderUvaHtml(db, p);
      name = `UVA_${p.label.replace(/\W+/g, '_')}.pdf`;
    } else if (report === 'ear') { html = renderEarHtml(db, year); name = `EA-Rechnung_${year}.pdf`; }
    else if (report === 'assets') { html = renderAssetsHtml(db, year); name = `Anlagenverzeichnis_${year}.pdf`; }
    else if (report === 'trips') { html = renderTripsHtml(db, year); name = `Fahrtenbuch_${year}.pdf`; }
    else if (report === 'cashbook') { html = renderCashBookHtml(db, year); name = `Kassabuch_${year}.pdf`; }
    else throw new Error('Unbekannter Bericht.');
    return save(name, await htmlToPdf(html), [{ name: 'PDF', extensions: ['pdf'] }]);
  });
}
