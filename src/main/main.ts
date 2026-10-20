import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { migrateDatabase, validateDatabase } from '../core/defaults';
import {
  addDunning,
  addPayment,
  cancelInvoice,
  convertOfferToInvoice,
  createDraft,
  deleteDraft,
  finalizeDocument,
  newId,
  removePayment,
  saveDraft,
  settingsFor,
} from '../core/documents';
import { toCii } from '../core/einvoice/cii';
import { toEbInterface } from '../core/einvoice/ebinterface';
import { buildModel } from '../core/einvoice/model';
import { toUbl } from '../core/einvoice/ubl';
import { kindLabel } from '../core/i18n';
import { validatePattern } from '../core/numbering';
import { invoicesCsv } from '../core/reports';
import { renderDocumentHtml, renderDunningHtml } from '../core/template';
import type { Article, BusinessDocument, CompanySettings, Customer, Database, OfferStatus } from '../core/types';
import type { EInvoiceFormat } from '../preload/api';
import { embedFacturX, htmlToPdf } from './pdf';
import { Store } from './store';
import { registerAccountingIpc } from './accounting';

let store: Store;
let win: BrowserWindow | null = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    title: 'Rechnung Austria',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  const devUrl = app.isPackaged ? undefined : process.env.VITE_DEV_SERVER_URL;
  if (devUrl) win.loadURL(devUrl);
  else win.loadFile(path.join(__dirname, '../renderer/index.html'));
}

/** Gültige Dateinamen aus Dokumentnummern */
const safeName = (s: string) => s.replace(/[^\w.\-]+/g, '_');

function doc(db: Database, id: string): BusinessDocument {
  const d = db.documents.find((x) => x.id === id);
  if (!d) throw new Error('Dokument nicht gefunden.');
  return d;
}

function customerOf(db: Database, d: BusinessDocument): Customer | undefined {
  return d.customerSnapshot ?? db.customers.find((c) => c.id === d.customerId);
}

async function saveFile(defaultName: string, data: string | Uint8Array, filters: Electron.FileFilter[]): Promise<string | null> {
  const res = await dialog.showSaveDialog(win!, { defaultPath: defaultName, filters });
  if (res.canceled || !res.filePath) return null;
  fs.writeFileSync(res.filePath, data);
  return res.filePath;
}

function docHtml(db: Database, d: BusinessDocument): string {
  const source = d.sourceDocumentId ? db.documents.find((x) => x.id === d.sourceDocumentId) : undefined;
  return renderDocumentHtml({ doc: d, settings: settingsFor(db, d), customer: customerOf(db, d), sourceNumber: source?.number });
}

function eInvoiceXml(db: Database, d: BusinessDocument, format: EInvoiceFormat): string {
  const customer = customerOf(db, d);
  if (!customer) throw new Error('Für E-Rechnungen ist ein Kunde erforderlich.');
  const source = d.sourceDocumentId ? db.documents.find((x) => x.id === d.sourceDocumentId) : undefined;
  const model = buildModel(d, settingsFor(db, d), customer, source);
  if (format === 'ebinterface') return toEbInterface(model);
  if (format === 'xrechnung') return toUbl(model);
  return toCii(model);
}

type Handler = (...args: any[]) => unknown;
function handle(channel: string, fn: Handler) {
  ipcMain.handle(channel, async (e, ...args) => {
    try {
      // Nur das eigene Hauptfenster darf die API verwenden
      if (!win || e.sender !== win.webContents) throw new Error('Unzulässiger Aufrufer.');
      return { ok: true, value: await fn(...args) };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });
}

function registerIpc() {
  const mutate = <T>(fn: (db: Database) => { db: Database; result: T }) => store.update(fn);

  handle('db:get', () => store.get());
  handle('app:info', () => ({ dataFile: store.dataFile, version: app.getVersion() }));

  handle('settings:save', (s: CompanySettings) =>
    mutate((db) => {
      for (const p of [s.invoiceNumberPattern, s.offerNumberPattern, s.creditNoteNumberPattern]) {
        const err = validatePattern(p);
        if (err) throw new Error(`${p}: ${err}`);
      }
      return { db: { ...db, settings: s }, result: s };
    }),
  );

  handle('customer:save', (c: Customer) =>
    mutate((db) => {
      const isNew = !c.id;
      const maxNo = Math.max(0, ...db.customers.map((x) => Number(x.number.replace(/\D/g, '')) || 0));
      const nextNo = `K-${String(maxNo + 1).padStart(4, '0')}`;
      const cust = { ...c, id: c.id || newId(), number: c.number || nextNo };
      return {
        db: { ...db, customers: isNew ? [...db.customers, cust] : db.customers.map((x) => (x.id === cust.id ? cust : x)) },
        result: cust,
      };
    }),
  );
  handle('customer:delete', (id: string) =>
    mutate((db) => {
      if (db.documents.some((d) => d.customerId === id)) throw new Error('Kunde hat Dokumente und kann nicht gelöscht werden.');
      return { db: { ...db, customers: db.customers.filter((c) => c.id !== id) }, result: true };
    }),
  );

  handle('article:save', (a: Article) =>
    mutate((db) => {
      const art = { ...a, id: a.id || newId() };
      const exists = db.articles.some((x) => x.id === art.id);
      return { db: { ...db, articles: exists ? db.articles.map((x) => (x.id === art.id ? art : x)) : [...db.articles, art] }, result: art };
    }),
  );
  handle('article:delete', (id: string) => mutate((db) => ({ db: { ...db, articles: db.articles.filter((a) => a.id !== id) }, result: true })));

  handle('doc:create', (kind: 'offer' | 'invoice', customerId: string) =>
    mutate((db) => {
      const d = createDraft(db, kind, customerId);
      return { db: saveDraft(db, d), result: d };
    }),
  );
  handle('doc:save', (d: BusinessDocument) => mutate((db) => ({ db: saveDraft(db, d), result: d })));
  handle('doc:delete', (id: string) => mutate((db) => ({ db: deleteDraft(db, id), result: true })));
  handle('doc:finalize', (id: string) =>
    mutate((db) => {
      const r = finalizeDocument(db, id);
      return { db: r.db, result: r.doc };
    }),
  );
  handle('doc:convert', (id: string) =>
    mutate((db) => {
      const r = convertOfferToInvoice(db, id);
      return { db: r.db, result: r.doc };
    }),
  );
  handle('doc:cancel', (id: string) =>
    mutate((db) => {
      const r = cancelInvoice(db, id);
      return { db: r.db, result: r.doc };
    }),
  );
  handle('doc:duplicate', (id: string) =>
    mutate((db) => {
      const src = doc(db, id);
      const kind = src.kind === 'offer' ? 'offer' : 'invoice';
      const d = createDraft(db, kind, src.customerId);
      const copy = { ...d, taxCase: src.taxCase, language: src.language, title: src.title, introText: src.introText, closingText: src.closingText, items: src.items.map((i) => ({ ...i, id: newId(), quantity: Math.abs(i.quantity) })) };
      return { db: saveDraft(db, copy), result: copy };
    }),
  );
  handle('doc:offerStatus', (id: string, status: OfferStatus) =>
    mutate((db) => {
      const d = doc(db, id);
      if (d.kind !== 'offer') throw new Error('Kein Angebot.');
      const upd = { ...d, offerStatus: status };
      return { db: { ...db, documents: db.documents.map((x) => (x.id === id ? upd : x)) }, result: upd };
    }),
  );
  handle('payment:add', (id: string, p: { date: string; amount: number; note: string }) =>
    mutate((db) => ({ db: addPayment(db, id, p), result: true })),
  );
  handle('payment:remove', (id: string, paymentId: string) =>
    mutate((db) => {
      return { db: removePayment(db, id, paymentId), result: true };
    }),
  );
  handle('dunning:add', (id: string, opts: { chargeInterest: boolean; applyCollectionFee: boolean }) =>
    mutate((db) => ({ db: addDunning(db, id, opts), result: true })),
  );

  handle('export:pdf', async (id: string) => {
    const db = store.get();
    const d = doc(db, id);
    const pdf = await htmlToPdf(docHtml(db, d));
    const name = `${kindLabel(d.kind, d.language)}_${safeName(d.number || 'Entwurf')}.pdf`;
    return saveFile(name, pdf, [{ name: 'PDF', extensions: ['pdf'] }]);
  });
  handle('export:dunningPdf', async (id: string, level: number) => {
    const db = store.get();
    const d = doc(db, id);
    const record = d.dunning.find((x) => x.level === level);
    if (!record) throw new Error('Mahnstufe nicht gefunden.');
    const html = renderDunningHtml({ doc: d, settings: settingsFor(db, d), customer: customerOf(db, d), record });
    return saveFile(`Mahnung${level}_${safeName(d.number)}.pdf`, await htmlToPdf(html), [{ name: 'PDF', extensions: ['pdf'] }]);
  });
  handle('export:einvoice', async (id: string, format: EInvoiceFormat) => {
    const db = store.get();
    const d = doc(db, id);
    const xml = eInvoiceXml(db, d, format);
    if (format === 'zugferd') {
      const pdf = await htmlToPdf(docHtml(db, d));
      const s = settingsFor(db, d);
      const out = await embedFacturX(pdf, xml, { title: `${kindLabel(d.kind, d.language)} ${d.number}`, author: s.name });
      return saveFile(`${safeName(d.number)}_zugferd.pdf`, out, [{ name: 'PDF (ZUGFeRD/Factur-X)', extensions: ['pdf'] }]);
    }
    const suffix = format === 'ebinterface' ? 'ebinterface' : 'xrechnung';
    return saveFile(`${safeName(d.number)}_${suffix}.xml`, xml, [{ name: 'XML', extensions: ['xml'] }]);
  });
  handle('export:csv', (year: number) =>
    saveFile(`Rechnungen_${year}.csv`, invoicesCsv(store.get(), year), [{ name: 'CSV', extensions: ['csv'] }]),
  );
  handle('backup:export', () => {
    const stamp = new Date().toISOString().slice(0, 10);
    return saveFile(`rechnung-backup-${stamp}.json`, JSON.stringify(store.get(), null, 1), [{ name: 'JSON', extensions: ['json'] }]);
  });
  handle('backup:import', async () => {
    const res = await dialog.showOpenDialog(win!, { filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] });
    if (res.canceled || !res.filePaths[0]) return false;
    const parsed = JSON.parse(fs.readFileSync(res.filePaths[0], 'utf8'));
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.documents)) throw new Error('Keine gültige Sicherungsdatei.');
    const confirm = await dialog.showMessageBox(win!, {
      type: 'warning',
      buttons: ['Abbrechen', 'Wiederherstellen'],
      defaultId: 0,
      cancelId: 0,
      message: 'Aktuelle Daten durch die Sicherung ersetzen?',
      detail: 'Vom aktuellen Stand wird vorher automatisch ein Backup erstellt.',
    });
    if (confirm.response !== 1) return false;
    store.replace(validateDatabase(migrateDatabase(parsed)));
    return true;
  });
  handle('app:showDataFolder', () => shell.showItemInFolder(store.dataFile));
  registerAccountingIpc(handle, store, () => win);
}

// Deutsche Datums- und Zahlenformate in Eingabefeldern
app.commandLine.appendSwitch('lang', 'de-AT');

app.whenReady().then(() => {
  try {
    // RECHNUNG_DATA_DIR erlaubt einen abweichenden Datenordner (z. B. portable Nutzung auf USB-Stick)
    store = new Store(process.env.RECHNUNG_DATA_DIR || app.getPath('userData'));
  } catch (e) {
    dialog.showErrorBox('Daten konnten nicht geladen werden', (e as Error).message);
    app.quit();
    return;
  }
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
