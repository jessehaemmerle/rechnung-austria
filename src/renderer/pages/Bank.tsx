import { useMemo, useState } from 'react';
import {
  accountBalance, applyMapping, detectMapping, negativeCashDays, parseCamt053, parseCsv, suggestMatches,
  type ColumnMapping, type ImportedTx,
} from '../../core/accounting/bank';
import { CATEGORIES, categoryById } from '../../core/accounting/categories';
import { emptyEntry } from '../../core/accounting/entries';
import { formatDate, todayIso } from '../../core/dates';
import { formatEuro } from '../../core/money';
import type { BankAccount, BankTransaction, BankTxLink, Database } from '../../core/types';
import { api } from '../api';
import type { PageProps } from '../App';
import { Empty, Field, MoneyInput } from '../components/fields';

const LINK_LABEL: Record<BankTxLink['type'], string> = {
  invoice: 'Rechnung', entry: 'Buchung', private: 'Privat', transfer: 'Umbuchung', tax: 'Finanzamt', ignored: 'Ignoriert',
};

function linkText(db: Database, l: BankTxLink): string {
  if (l.type === 'invoice') return `Rechnung ${db.documents.find((d) => d.id === l.documentId)?.number ?? ''}`;
  if (l.type === 'entry') {
    const e = db.entries.find((x) => x.id === l.entryId);
    return e ? `${categoryById(e.category).label}` : 'Buchung';
  }
  return LINK_LABEL[l.type];
}

interface Preview { rows: string[][]; mapping: ColumnMapping; format: string; camt?: ImportedTx[] }

export function Bank({ db, reload, notify }: PageProps) {
  const [accountId, setAccountId] = useState(db.bankAccounts[0]?.id ?? '');
  const [newAcc, setNewAcc] = useState<BankAccount | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [show, setShow] = useState<'open' | 'all'>('open');
  const [assign, setAssign] = useState<{ tx: BankTransaction; category: string } | null>(null);
  const [cashMove, setCashMove] = useState({ date: todayIso(), amount: 0, purpose: '', type: 'private' as 'private' | 'transfer', sign: 1 });
  const account = db.bankAccounts.find((a) => a.id === accountId) ?? db.bankAccounts[0];
  const isCash = account?.kind === 'cash';

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      const r = await fn();
      await reload();
      if (ok) notify(ok);
      return r;
    } catch (e) {
      notify((e as Error).message, 'error');
      return undefined;
    }
  };

  const txs = useMemo(
    () => db.bankTransactions.filter((t) => t.accountId === account?.id && (show === 'all' || !t.link)).sort((a, b) => b.date.localeCompare(a.date)),
    [db.bankTransactions, account?.id, show],
  );

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return notify('Die Datei ist größer als 5 MB. Bitte den Auszug in kleineren Zeiträumen exportieren.', 'error');
    const text = await file.text();
    try {
      if (/<(\w+:)?BkToCstmrStmt/.test(text)) {
        const camt = parseCamt053(text);
        setPreview({ rows: [], mapping: detectMapping([[]]).mapping, format: 'camt.053', camt });
      } else {
        const rows = parseCsv(text);
        const { format, mapping } = detectMapping(rows);
        setPreview({ rows, mapping, format });
      }
    } catch (e) {
      notify(`Datei nicht lesbar: ${(e as Error).message}`, 'error');
    }
  };
  const parsed = preview ? (preview.camt ? { txs: preview.camt, errors: [] } : applyMapping(preview.rows, preview.mapping)) : null;
  const header = preview?.rows[0] ?? [];
  const colOptions = header.map((h, i) => <option key={i} value={i}>{preview?.mapping.hasHeader ? h || `Spalte ${i + 1}` : `Spalte ${i + 1}: ${h.slice(0, 20)}`}</option>);
  const setMap = (p: Partial<ColumnMapping>) => preview && setPreview({ ...preview, mapping: { ...preview.mapping, ...p } });

  if (db.bankAccounts.length === 0 && !newAcc) {
    return (
      <div className="page">
        <header className="page-head"><h1>Bank & Kassa</h1></header>
        <Empty>
          Legen Sie Ihr Geschäftskonto an, um Kontoauszüge zu importieren und Zahlungen automatisch zuzuordnen.
          <div className="bar center">
            <button className="primary" onClick={() => setNewAcc({ id: '', name: 'Geschäftskonto', kind: 'bank', iban: db.settings.iban, openingBalance: 0, openingDate: `${todayIso().slice(0, 4)}-01-01` })}>Bankkonto anlegen</button>
            <button onClick={() => setNewAcc({ id: '', name: 'Kassa', kind: 'cash', iban: '', openingBalance: 0, openingDate: `${todayIso().slice(0, 4)}-01-01` })}>Kassa anlegen</button>
          </div>
        </Empty>
      </div>
    );
  }

  return (
    <div className="page wide-page">
      <header className="page-head">
        <h1>Bank & Kassa</h1>
        <div className="actions">
          <button onClick={() => setNewAcc({ id: '', name: '', kind: 'bank', iban: '', openingBalance: 0, openingDate: `${todayIso().slice(0, 4)}-01-01` })}>Konto anlegen</button>
          {!db.bankAccounts.some((a) => a.kind === 'cash') && (
            <button onClick={() => setNewAcc({ id: '', name: 'Kassa', kind: 'cash', iban: '', openingBalance: 0, openingDate: `${todayIso().slice(0, 4)}-01-01` })}>Kassa anlegen</button>
          )}
        </div>
      </header>

      {newAcc && (
        <section className="panel">
          <h2>{newAcc.id ? 'Konto bearbeiten' : newAcc.kind === 'cash' ? 'Neue Kassa' : 'Neues Bankkonto'}</h2>
          <div className="grid">
            <Field label="Bezeichnung"><input value={newAcc.name} onChange={(e) => setNewAcc({ ...newAcc, name: e.target.value })} /></Field>
            {newAcc.kind === 'bank' && <Field label="IBAN"><input value={newAcc.iban} onChange={(e) => setNewAcc({ ...newAcc, iban: e.target.value.toUpperCase() })} /></Field>}
            <Field label="Anfangsbestand (€)"><MoneyInput value={newAcc.openingBalance} onChange={(c) => setNewAcc({ ...newAcc, openingBalance: c })} /></Field>
            <Field label="Stand zum"><input type="date" value={newAcc.openingDate} onChange={(e) => setNewAcc({ ...newAcc, openingDate: e.target.value })} /></Field>
          </div>
          <div className="bar">
            <button className="primary" onClick={async () => { if (await run(() => api.saveAccount(newAcc), 'Konto gespeichert.')) setNewAcc(null); }}>Konto speichern</button>
            <button onClick={() => setNewAcc(null)}>Abbrechen</button>
          </div>
        </section>
      )}

      <div className="tabs" role="tablist">
        {db.bankAccounts.map((a) => (
          <button key={a.id} role="tab" aria-selected={a.id === account?.id} className={a.id === account?.id ? 'tab active' : 'tab'} onClick={() => { setAccountId(a.id); setPreview(null); }}>
            {a.name} <span className="muted">{formatEuro(accountBalance(db, a.id))}</span>
          </button>
        ))}
      </div>

      {account && (
        <>
          <div className="toolbar">
            {!isCash ? (
              <label className="file-btn">
                Kontoauszug importieren (CSV, ELBA, George, camt.053)
                <input type="file" accept=".csv,.txt,.xml" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
            ) : (
              <button onClick={() => run(() => api.exportAccountingPdf('cashbook', Number(todayIso().slice(0, 4))), 'Kassabuch gespeichert.')}>Kassabuch als PDF</button>
            )}
            <select value={show} onChange={(e) => setShow(e.target.value as 'open' | 'all')} aria-label="Anzeige">
              <option value="open">Nicht zugeordnet</option><option value="all">Alle Bewegungen</option>
            </select>
            <button className="link" onClick={() => setNewAcc(account)}>Konto bearbeiten</button>
          </div>

          {isCash && (
            <>
              {negativeCashDays(db, account.id).length > 0 && (
                <div className="banner error">Kassastand negativ am {negativeCashDays(db, account.id).map((d) => formatDate(d)).join(', ')} – eine Kassa kann nicht ins Minus gehen. Fehlt eine Bareinlage?</div>
              )}
              <section className="panel">
                <h2>Bareinlage oder Abhebung</h2>
                <p className="muted">Barausgaben und -einnahmen entstehen automatisch, wenn Sie bei einer Buchung „Kassa“ wählen.</p>
                <div className="inline-form">
                  <input type="date" aria-label="Datum" value={cashMove.date} onChange={(e) => setCashMove({ ...cashMove, date: e.target.value })} />
                  <select aria-label="Richtung" value={cashMove.sign} onChange={(e) => setCashMove({ ...cashMove, sign: Number(e.target.value) })}>
                    <option value={1}>Einlage in die Kassa</option><option value={-1}>Entnahme aus der Kassa</option>
                  </select>
                  <MoneyInput ariaLabel="Betrag" value={cashMove.amount} onChange={(c) => setCashMove({ ...cashMove, amount: c })} />
                  <select aria-label="Art" value={cashMove.type} onChange={(e) => setCashMove({ ...cashMove, type: e.target.value as 'private' | 'transfer' })}>
                    <option value="private">Privat</option><option value="transfer">Bank ↔ Kassa</option>
                  </select>
                  <input placeholder="Text" aria-label="Text" value={cashMove.purpose} onChange={(e) => setCashMove({ ...cashMove, purpose: e.target.value })} />
                  <button onClick={() => run(() => api.addCash({ date: cashMove.date, amount: cashMove.sign * cashMove.amount, purpose: cashMove.purpose, type: cashMove.type }), 'Kassabewegung erfasst.')}>Erfassen</button>
                </div>
              </section>
            </>
          )}

          {preview && parsed && (
            <section className="panel">
              <h2>Import prüfen <span className="muted">– erkannt: {preview.format}</span></h2>
              {!preview.camt && (
                <div className="grid">
                  <label className="check field"><input type="checkbox" checked={preview.mapping.hasHeader} onChange={(e) => setMap({ hasHeader: e.target.checked })} /> Erste Zeile ist Kopfzeile</label>
                  <Field label="Datum"><select value={preview.mapping.date} onChange={(e) => setMap({ date: Number(e.target.value) })}>{colOptions}</select></Field>
                  <Field label="Betrag"><select value={preview.mapping.amount} onChange={(e) => setMap({ amount: Number(e.target.value) })}>{colOptions}</select></Field>
                  <Field label="Partner"><select value={preview.mapping.counterparty} onChange={(e) => setMap({ counterparty: Number(e.target.value) })}><option value={-1}>–</option>{colOptions}</select></Field>
                  <Field label="Verwendungszweck"><select value={preview.mapping.purpose[0] ?? -1} onChange={(e) => setMap({ purpose: Number(e.target.value) >= 0 ? [Number(e.target.value)] : [] })}><option value={-1}>–</option>{colOptions}</select></Field>
                  <Field label="Zahlungsreferenz"><select value={preview.mapping.reference} onChange={(e) => setMap({ reference: Number(e.target.value) })}><option value={-1}>–</option>{colOptions}</select></Field>
                </div>
              )}
              <p>{parsed.txs.length} Bewegungen erkannt{parsed.errors.length ? `, ${parsed.errors.length} Zeilen nicht lesbar` : ''}.</p>
              {parsed.errors.length > 0 && <ul className="small errors">{parsed.errors.slice(0, 5).map((e) => <li key={e}>{e}</li>)}</ul>}
              <table className="list compact">
                <tbody>
                  {parsed.txs.slice(0, 5).map((t, i) => (
                    <tr key={i}><td>{formatDate(t.date)}</td><td>{t.counterparty}</td><td className="ellipsis">{t.purpose}</td><td className="num">{formatEuro(t.amount)}</td></tr>
                  ))}
                </tbody>
              </table>
              <div className="bar">
                <button className="primary" disabled={!parsed.txs.length} onClick={async () => {
                  const r = (await run(() => api.importBank(account.id, parsed.txs))) as { added: number; duplicates: number } | undefined;
                  if (r) { notify(`${r.added} Bewegungen importiert${r.duplicates ? `, ${r.duplicates} bereits vorhanden` : ''}.`); setPreview(null); }
                }}>{parsed.txs.length} Bewegungen importieren</button>
                <button onClick={() => setPreview(null)}>Abbrechen</button>
              </div>
            </section>
          )}

          {txs.length === 0 ? (
            <Empty>{show === 'open' ? 'Alle Bewegungen sind zugeordnet.' : 'Noch keine Bewegungen.'}</Empty>
          ) : (
            <table className="list bank">
              <thead><tr><th>Datum</th><th>Partner / Verwendungszweck</th><th className="num">Betrag</th><th>Zuordnung</th></tr></thead>
              <tbody>
                {txs.map((t) => {
                  const sug = t.link ? [] : suggestMatches(db, t);
                  return (
                    <tr key={t.id}>
                      <td>{formatDate(t.date)}</td>
                      <td>{t.counterparty}{t.purpose !== t.counterparty && <div className="muted small ellipsis">{t.purpose} {t.reference}</div>}</td>
                      <td className={`num ${t.amount > 0 ? 'pos' : ''}`}>{formatEuro(t.amount)}</td>
                      <td className="assign">
                        {t.link ? (
                          <>
                            <span className="badge paid">{linkText(db, t.link)}</span>{' '}
                            {!t.hash.startsWith('cash') && <button className="link" onClick={() => run(() => api.unlinkTx(t.id), 'Zuordnung aufgehoben.')}>aufheben</button>}
                          </>
                        ) : assign?.tx.id === t.id ? (
                          <div className="inline-form">
                            <select aria-label="Kategorie" value={assign.category} onChange={(e) => setAssign({ ...assign, category: e.target.value })}>
                              {CATEGORIES.filter((c) => c.kind === (t.amount < 0 ? 'expense' : 'income')).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                            </select>
                            <button className="primary" onClick={async () => {
                              const tpl = { ...emptyEntry(t.amount < 0 ? 'expense' : 'income', t.date, db.settings), category: assign.category, inputTaxDeductible: !db.settings.isSmallBusiness && categoryById(assign.category).inputTaxDefault };
                              if (await run(() => api.createEntryFromTx(t.id, tpl), 'Buchung angelegt – Beleg unter „Ausgaben“ anhängen.')) setAssign(null);
                            }}>Buchen</button>
                            <button onClick={() => setAssign(null)}>Abbrechen</button>
                          </div>
                        ) : (
                          <div className="chips">
                            {sug.map((s) => (
                              <button key={s.id} className="chip suggest" onClick={() => run(() => (s.type === 'invoice' ? api.linkTxInvoice(t.id, s.id) : api.linkTxEntry(t.id, s.id)), 'Zugeordnet.')}>
                                {s.label}
                              </button>
                            ))}
                            <button className="chip" onClick={() => setAssign({ tx: t, category: t.amount < 0 ? 'other_expense' : 'revenue_other' })}>{t.amount < 0 ? 'Als Ausgabe buchen' : 'Als Einnahme buchen'}</button>
                            <button className="chip" onClick={() => run(() => api.markTx(t.id, 'private'))}>Privat</button>
                            <button className="chip" onClick={() => run(() => api.markTx(t.id, 'tax'))} title="USt- und ESt-Zahlungen sind erfolgsneutral. SVS-Beiträge bitte als Ausgabe „SVS-Beiträge“ buchen.">Finanzamt</button>
                            <button className="chip" onClick={() => run(() => api.markTx(t.id, 'transfer'))}>Umbuchung</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
