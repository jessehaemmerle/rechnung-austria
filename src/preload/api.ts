import type { Article, BusinessDocument, CompanySettings, Customer, Database, OfferStatus } from '../core/types';

export type EInvoiceFormat = 'ebinterface' | 'xrechnung' | 'zugferd';

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
};
