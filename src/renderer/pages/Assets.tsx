import { useState } from 'react';
import { afaSchedule, LOW_VALUE_LIMIT, USEFUL_LIFE_HINTS } from '../../core/accounting/assets';
import { formatDate, todayIso } from '../../core/dates';
import { formatEuro } from '../../core/money';
import type { Asset } from '../../core/types';
import { api } from '../api';
import type { PageProps } from '../App';
import { Empty, Field, MoneyInput } from '../components/fields';

export function Assets({ db, reload, notify }: PageProps) {
  const [edit, setEdit] = useState<Asset | null>(null);
  const year = Number(todayIso().slice(0, 4));
  const set = (p: Partial<Asset>) => edit && setEdit({ ...edit, ...p });
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try { const r = await fn(); await reload(); if (ok) notify(ok); return r; } catch (e) { notify((e as Error).message, 'error'); return undefined; }
  };

  return (
    <div className="page">
      <header className="page-head">
        <h1>Anlagenverzeichnis</h1>
        <div className="actions">
          <button onClick={() => run(() => api.exportAccountingPdf('assets', year), 'Anlagenverzeichnis gespeichert.')}>Als PDF ({year})</button>
          <button className="primary" onClick={() => setEdit({ id: '', name: '', acquisitionDate: todayIso(), inServiceDate: todayIso(), cost: 0, usefulLifeYears: 3, lowValue: false, disposalDate: '', disposalProceeds: 0, disposalVatRate: db.settings.isSmallBusiness ? 0 : 20, businessUsePercent: 100, notes: '' })}>
            Wirtschaftsgut anlegen
          </button>
        </div>
      </header>
      <p className="muted">Ausgaben der Kategorie „Anlagegut“ erscheinen hier automatisch. Abgeschrieben wird linear; bei Inbetriebnahme im zweiten Halbjahr nur die halbe Jahres-AfA. Bis 1.000 € netto ist eine Sofortabschreibung als GWG möglich.</p>

      {edit && (
        <section className="panel">
          <div className="grid">
            <Field label="Bezeichnung" wide><input value={edit.name} onChange={(e) => set({ name: e.target.value })} /></Field>
            <Field label="Anschaffung"><input type="date" value={edit.acquisitionDate} disabled={!!edit.entryId} onChange={(e) => set({ acquisitionDate: e.target.value })} /></Field>
            <Field label="Inbetriebnahme"><input type="date" value={edit.inServiceDate} onChange={(e) => set({ inServiceDate: e.target.value })} /></Field>
            <Field label="Anschaffungskosten (€)" hint={edit.entryId ? 'Aus der Ausgabe übernommen' : 'Netto bei Vorsteuerabzug, sonst brutto'}>
              <MoneyInput value={edit.cost} disabled={!!edit.entryId} onChange={(c) => set({ cost: c })} />
            </Field>
            <Field label="Nutzungsdauer (Jahre)" hint={USEFUL_LIFE_HINTS.map((h) => `${h.label}: ${h.years}`).join(' · ')}>
              <input type="number" min={1} value={edit.usefulLifeYears} disabled={edit.lowValue} onChange={(e) => set({ usefulLifeYears: Number(e.target.value) })} />
            </Field>
            <Field label="Betriebliche Nutzung (%)"><input type="number" min={0} max={100} value={edit.businessUsePercent} onChange={(e) => set({ businessUsePercent: Number(e.target.value) })} /></Field>
            <label className="check field"><input type="checkbox" checked={edit.lowValue} disabled={edit.cost > LOW_VALUE_LIMIT} onChange={(e) => set({ lowValue: e.target.checked })} /> Geringwertiges Wirtschaftsgut – sofort abschreiben</label>
            <Field label="Ausgeschieden am" hint="Verkauf, Entnahme oder Verschrottung"><input type="date" value={edit.disposalDate} onChange={(e) => set({ disposalDate: e.target.value })} /></Field>
            <Field label="Verkaufserlös netto (€)" hint="Nicht zusätzlich als Einnahme buchen"><MoneyInput value={edit.disposalProceeds} onChange={(c) => set({ disposalProceeds: c })} /></Field>
            {!db.settings.isSmallBusiness && (
              <Field label="USt auf den Verkauf">
                <select value={edit.disposalVatRate ?? 20} onChange={(e) => set({ disposalVatRate: Number(e.target.value) as 20 | 13 | 10 | 0 })}>
                  {[20, 13, 10, 0].map((r) => <option key={r} value={r}>{r} %</option>)}
                </select>
              </Field>
            )}
            <Field label="Notiz" wide><input value={edit.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
          </div>
          {edit.cost > 0 && (
            <table className="list compact afa">
              <thead><tr><th>Jahr</th><th className="num">AfA</th><th className="num">Restbuchwert</th></tr></thead>
              <tbody>{afaSchedule(edit).map((r) => <tr key={r.year}><td>{r.year}</td><td className="num">{formatEuro(r.afa + r.disposalLoss)}</td><td className="num">{formatEuro(r.bookValue)}</td></tr>)}</tbody>
            </table>
          )}
          <div className="bar">
            <button className="primary" onClick={async () => { if (await run(() => api.saveAsset(edit), 'Wirtschaftsgut gespeichert.')) setEdit(null); }}>Speichern</button>
            <button onClick={() => setEdit(null)}>Abbrechen</button>
            {edit.id && !edit.entryId && <button className="danger-text" onClick={async () => { if (window.confirm('Wirtschaftsgut löschen?')) { await run(() => api.deleteAsset(edit.id)); setEdit(null); } }}>Löschen</button>}
          </div>
        </section>
      )}

      {db.assets.length === 0 ? (
        <Empty>Noch keine Wirtschaftsgüter.</Empty>
      ) : (
        <table className="list">
          <thead><tr><th>Wirtschaftsgut</th><th>Anschaffung</th><th className="num">AK</th><th>ND</th><th className="num">AfA {year}</th><th className="num">Buchwert 31.12.</th></tr></thead>
          <tbody>
            {db.assets.map((a) => {
              const sch = afaSchedule(a);
              const r = sch.find((x) => x.year === year);
              const last = sch.filter((x) => x.year <= year).pop();
              return (
                <tr key={a.id} onClick={() => setEdit(a)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setEdit(a)}>
                  <td>{a.name}{a.disposalDate && <span className="tag">ausgeschieden</span>}</td>
                  <td>{formatDate(a.acquisitionDate)}</td>
                  <td className="num">{formatEuro(a.cost)}</td>
                  <td>{a.lowValue ? 'GWG' : `${a.usefulLifeYears} J.`}</td>
                  <td className="num">{formatEuro((r?.afa ?? 0) + (r?.disposalLoss ?? 0))}</td>
                  <td className="num">{formatEuro(last ? last.bookValue : a.cost)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
