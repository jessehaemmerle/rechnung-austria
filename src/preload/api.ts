import type { ImportedTx } from '../core/accounting/bank';
import type { Article, Asset, BankAccount, BusinessDocument, CompanySettings, Customer, Database, Entry, OfferStatus, Trip } from '../core/types';

export type EInvoiceFormat = 'ebinterface' | 'xrechnung' | 'zugferd';
export type AccountingReport = 'uva' | 'ear' | 'assets' | 'trips' | 'cashbook';

/** Schnittstelle zwischen Oberfläche und Hauptprozess (alle Aufrufe asynchron). */
export interface Api {
  getDb(): Promise<Database>;
  appInfo(): Promise<{ dataFile: string; version: string }>;
  saveSettings(s: CompanySettings): Promise<CompanySettings>;
  saveCustomer(c: Customer): Promise<Customer>;
  deleteCustomer(id: string): Promise<boolean>;
  saveArticle(a: Article): Promise<Article>;
  deleteArticle(id: string): Promise<boolean>;
  createDoc(kind: 'offer' | 'invoice', customerId: string): Promise<BusinessDocument>;
  saveDoc(d: BusinessDocument): Promise<BusinessDocument>;
  deleteDoc(id: string): Promise<boolean>;
  finalizeDoc(id: string): Promise<BusinessDocument>;
  convertOffer(id: string): Promise<BusinessDocument>;
  cancelInvoice(id: string): Promise<BusinessDocument>;
  duplicateDoc(id: string): Promise<BusinessDocument>;
  setOfferStatus(id: string, status: OfferStatus): Promise<BusinessDocument>;
  addPayment(id: string, p: { date: string; amount: number; note: string }): Promise<boolean>;
  removePayment(id: string, paymentId: string): Promise<boolean>;
  addDunning(id: string, opts: { chargeInterest: boolean; applyCollectionFee: boolean }): Promise<boolean>;
  exportPdf(id: string): Promise<string | null>;
  exportDunningPdf(id: string, level: number): Promise<string | null>;
  exportEInvoice(id: string, format: EInvoiceFormat): Promise<string | null>;
  exportCsv(year: number): Promise<string | null>;
  exportBackup(): Promise<string | null>;
  importBackup(): Promise<boolean>;
  showDataFolder(): Promise<void>;
  saveEntry(e: Entry): Promise<Entry>;
  deleteEntry(id: string): Promise<boolean>;
  attachReceipt(entryId: string): Promise<boolean>;
  openReceipt(entryId: string, index: number): Promise<boolean>;
  saveAsset(a: Asset): Promise<boolean>;
  deleteAsset(id: string): Promise<boolean>;
  saveTrip(t: Trip): Promise<boolean>;
  deleteTrip(id: string): Promise<boolean>;
  saveAccount(a: BankAccount): Promise<boolean>;
  deleteAccount(id: string): Promise<boolean>;
  importBank(accountId: string, txs: ImportedTx[]): Promise<{ added: number; duplicates: number }>;
  linkTxInvoice(txId: string, docId: string): Promise<boolean>;
  linkTxEntry(txId: string, entryId: string): Promise<boolean>;
  createEntryFromTx(txId: string, template: Entry): Promise<Entry>;
  markTx(txId: string, type: 'private' | 'transfer' | 'tax' | 'ignored'): Promise<boolean>;
  unlinkTx(txId: string): Promise<boolean>;
  addCash(m: { date: string; amount: number; purpose: string; type: 'private' | 'transfer' }): Promise<boolean>;
  exportBmd(year: number): Promise<string | null>;
  exportDatev(year: number, meta: { consultant: string; client: string }): Promise<string | null>;
  exportAccountingPdf(report: AccountingReport, year: number, periodIndex?: number): Promise<string | null>;
}

export const channels: Record<keyof Api, string> = {
  getDb: 'db:get',
  appInfo: 'app:info',
  saveSettings: 'settings:save',
  saveCustomer: 'customer:save',
  deleteCustomer: 'customer:delete',
  saveArticle: 'article:save',
  deleteArticle: 'article:delete',
  createDoc: 'doc:create',
  saveDoc: 'doc:save',
  deleteDoc: 'doc:delete',
  finalizeDoc: 'doc:finalize',
  convertOffer: 'doc:convert',
  cancelInvoice: 'doc:cancel',
  duplicateDoc: 'doc:duplicate',
  setOfferStatus: 'doc:offerStatus',
  addPayment: 'payment:add',
  removePayment: 'payment:remove',
  addDunning: 'dunning:add',
  exportPdf: 'export:pdf',
  exportDunningPdf: 'export:dunningPdf',
  exportEInvoice: 'export:einvoice',
  exportCsv: 'export:csv',
  exportBackup: 'backup:export',
  importBackup: 'backup:import',
  showDataFolder: 'app:showDataFolder',
  saveEntry: 'entry:save',
  deleteEntry: 'entry:delete',
  attachReceipt: 'entry:attachReceipt',
  openReceipt: 'entry:openReceipt',
  saveAsset: 'asset:save',
  deleteAsset: 'asset:delete',
  saveTrip: 'trip:save',
  deleteTrip: 'trip:delete',
  saveAccount: 'account:save',
  deleteAccount: 'account:delete',
  importBank: 'bank:import',
  linkTxInvoice: 'bank:linkInvoice',
  linkTxEntry: 'bank:linkEntry',
  createEntryFromTx: 'bank:createEntry',
  markTx: 'bank:mark',
  unlinkTx: 'bank:unlink',
  addCash: 'cash:add',
  exportBmd: 'export:bmd',
  exportDatev: 'export:datev',
  exportAccountingPdf: 'export:accountingPdf',
};
