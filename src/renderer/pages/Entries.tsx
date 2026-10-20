import { useMemo, useState } from 'react';
import { CATEGORIES, categoryById } from '../../core/accounting/categories';
import { emptyEntry, entryAmounts } from '../../core/accounting/entries';
import { formatDate, todayIso } from '../../core/dates';
import { formatEuro } from '../../core/money';
import type { Entry, InputTaxCase, VatRate } from '../../core/types';
import { api } from '../api';
import type { PageProps } from '../App';
import { Empty, Field, MoneyInput } from '../components/fields';

const TAX_CASES: { value: InputTaxCase; label: string }[] = [
  { value: 'domestic', label: 'Inland mit USt' },
  { value: 'reverse_charge', label: 'EU-Leistung, Reverse Charge' },
  { value: 'ig_acquisition', label: 'Innergemeinschaftlicher Erwerb' },
  { value: 'none', label: 'Ohne USt' },
];

/** Formular für eine Ausgabe oder Einnahme (auch aus der Bankzuordnung verwendet) */
export function EntryForm({ entry, onChange, small }: { entry: Entry; onChange: (e: Entry) => void; small: boolean }) {
  const set = (p: Partial<Entry>) => onChange({ ...entry, ...p });
  const cats = CATEGORIES.filter((c) => c.kind === entry.kind);
  const cat = categoryById(entry.category);
  const a = entryAmounts(entry, { isSmallBusiness: small });
  return (
    <div className="grid">
      <Field label="Kategorie" wide hint={cat.hint ?? `E1a-Kennzahl ${cat.e1a}`}>
        <select value={entry.category} onChange={(e) => set({ category: e.target.value, inputTaxDeductible: !small && categoryById(e.target.value).inputTaxDefault })}>
          {cats.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </Field>
      <Field label={entry.kind === 'expense' ? 'Lieferant / Empfänger' : 'Zahler'}><input value={entry.counterparty} onChange={(e) => set({ counterparty: e.target.value })} /></Field>
      <Field label="Belegnummer"><input value={entry.receiptNumber} onChange={(e) => set({ receiptNumber: e.target.value })} /></Field>
      <Field label="Beschreibung" wide><input value={entry.description} onChange={(e) => set({ description: e.target.value })} /></Field>
      <Field label="Belegdatum"><input type="date" value={entry.date} onChange={(e) => set({ date: e.target.value })} /></Field>
      <Field label="Bezahlt am" hint="Leer = noch offen"><input type="date" value={entry.paidDate} onChange={(e) => set({ paidDate: e.target.value })} /></Field>
      <Field label="Bezahlt über">
        <select value={entry.paidVia} onChange={(e) => set({ paidVia: e.target.value as Entry['paidVia'] })}>
          <option value="bank">Bank</option><option value="cash">Kassa (bar)</option><option value="">–</option>
        </select>
      </Field>
      <Field label={entry.taxCase === 'domestic' ? 'Betrag brutto (€)' : 'Betrag netto (€)'}>
        <MoneyInput value={entry.gross} onChange={(c) => set({ gross: c })} />
      </Field>
      {entry.kind === 'expense' && (
        <Field label="Steuerfall">
          <select value={entry.taxCase} onChange={(e) => set({ taxCase: e.target.value as InputTaxCase })}>
            {TAX_CASES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>
      )}
      {(entry.taxCase !== 'none' && (!small || entry.kind === 'expense')) && (
        <Field label="USt-Satz">
          <select value={entry.vatRate} onChange={(e) => set({ vatRate: Number(e.target.value) as VatRate })}>
            {[20, 13, 10, 0].map((r) => <option key={r} value={r}>{r} %</option>)}
          </select>
        </Field>
      )}
      {entry.kind === 'expense' && !small && (
        <label className="check field"><input type="checkbox" checked={entry.inputTaxDeductible} onChange={(e) => set({ inputTaxDeductible: e.target.checked })} /> Vorsteuerabzug</label>
      )}
      <div className="field wide calc">
        Netto {formatEuro(a.net)} · USt {formatEuro(a.vat)}
        {entry.kind === 'expense' && <> · Vorsteuer {formatEuro(a.inputTax)} · absetzbar {formatEuro(a.incomeTaxAmount)}</>}
      </div>
      <Field label="Notiz" wide><textarea rows={2} value={entry.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
    </div>
  );
}

export function Entries({ db, reload, notify }: PageProps) {
  const [edit, setEdit] = useState<Entry | null>(null);
  const [year, setYear] = useState(todayIso().slice(0, 4));
  const [filter, setFilter] = useState<'all' | 'open' | 'noreceipt'>('all');
  const [query, setQuery] = useState('');
  const small = db.settings.isSmallBusiness;

  const years = useMemo(() => [...new Set([todayIso().slice(0, 4), ...db.entries.map((e) => e.date.slice(0, 4))])].sort().reverse(), [db.entries]);
  const list = db.entries
    .filter((e) => !year || e.date.startsWith(year) || e.paidDate.startsWith(year))
    .filter((e) => filter === 'all' || (filter === 'open' ? !e.paidDate : e.receipts.length === 0))
    .filter((e) => !query || `${e.counterparty} ${e.description} ${e.receiptNumber}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => b.date.localeCompare(a.date));

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

  const save = async () => {
    if (!edit) return;
    const saved = (await run(() => api.saveEntry(edit), 'Buchung gespeichert.')) as Entry | undefined;
    if (saved) setEdit(null);
  };

  const sumExp = list.filter((e) => e.kind === 'expense').reduce((s, e) => s + e.gross, 0);

  return (
    <div className="page">
      <header className="page-head">
        <h1>Ausgaben & Belege</h1>
        <div className="actions">
          <button onClick={() => setEdit(emptyEntry('income', todayIso(), db.settings))}>Einnahme erfassen</button>
          <button className="primary" onClick={() => setEdit(emptyEntry('expense', todayIso(), db.settings))}>Ausgabe erfassen</button>
        </div>
      </header>
      <p className="muted">Einnahmen aus Ihren Rechnungen werden automatisch über die Zahlungen erfasst. Hier buchen Sie Eingangsrechnungen, Kassenbelege und sonstige Einnahmen.</p>

      {edit && (
        <section className="panel">
          <h2>{edit.id ? 'Buchung bearbeiten' : edit.kind === 'expense' ? 'Neue Ausgabe' : 'Neue Einnahme'}</h2>
          <EntryForm entry={edit} onChange={setEdit} small={small} />
          {edit.id && (
            <div className="receipts">
              <h3>Belege</h3>
              {edit.receipts.length === 0 && <p className="muted">Noch kein Beleg. Belege sind 7 Jahre aufzubewahren.</p>}
              <ul className="plain">
                {db.entries.find((x) => x.id === edit.id)?.receipts.map((r, i) => (
                  <li key={r.path}>
                    <button className="link" onClick={() => run(() => api.openReceipt(edit.id, i))}>{r.originalName}</button>{' '}
                    <span className="muted">({Math.round(r.size / 1024)} KB, hinzugefügt {formatDate(r.addedAt.slice(0, 10))})</span>
                  </li>
                ))}
              </ul>
              <button onClick={async () => { await run(() => api.attachReceipt(edit.id)); const fresh = (await api.getDb()).entries.find((x) => x.id === edit.id); if (fresh) setEdit({ ...edit, receipts: fresh.receipts }); }}>Beleg hinzufügen</button>
            </div>
          )}
          <div className="bar">
            <button className="primary" onClick={save}>Buchung speichern</button>
            <button onClick={() => setEdit(null)}>Abbrechen</button>
            {edit.id && (
              <button className="danger-text" onClick={async () => { if (window.confirm('Buchung löschen?')) { await run(() => api.deleteEntry(edit.id), 'Buchung gelöscht.'); setEdit(null); } }}>
                Buchung löschen
              </button>
            )}
          </div>
          {!edit.id && <p className="muted">Belege können Sie nach dem ersten Speichern anhängen.</p>}
        </section>
      )}

      <div className="filters">
        <input type="search" placeholder="Lieferant, Text oder Belegnummer" aria-label="Suchen" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select value={year} onChange={(e) => setYear(e.target.value)} aria-label="Jahr">
          <option value="">Alle Jahre</option>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Filter">
          <option value="all">Alle</option><option value="open">Unbezahlt</option><option value="noreceipt">Ohne Beleg</option>
        </select>
      </div>

      {list.length === 0 ? (
        <Empty>Keine Buchungen in diesem Zeitraum. Erfassen Sie Ihre erste Ausgabe oder ordnen Sie Bankbewegungen zu.</Empty>
      ) : (
        <table className="list">
          <thead><tr><th>Datum</th><th>Lieferant / Text</th><th>Kategorie</th><th>Bezahlt</th><th>Beleg</th><th className="num">Betrag</th></tr></thead>
          <tbody>
            {list.map((e) => (
              <tr key={e.id} onClick={() => setEdit(e)} tabIndex={0} onKeyDown={(k) => k.key === 'Enter' && setEdit(e)}>
                <td>{formatDate(e.date)}</td>
                <td>{e.counterparty}<div className="muted small">{e.description}</div></td>
                <td>{categoryById(e.category).label}</td>
                <td>{e.paidDate ? formatDate(e.paidDate) : <span className="badge overdue">offen</span>}</td>
                <td>{e.receipts.length ? `${e.receipts.length} ✓` : <span className="muted">fehlt</span>}</td>
                <td className={`num ${e.kind === 'income' ? 'pos' : ''}`}>{e.kind === 'income' ? '+' : '−'}{formatEuro(e.gross)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={5}>Summe Ausgaben (brutto)</td><td className="num">{formatEuro(sumExp)}</td></tr></tfoot>
        </table>
      )}
    </div>
  );
}
