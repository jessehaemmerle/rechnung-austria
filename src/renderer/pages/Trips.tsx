import { useState } from 'react';
import { kmAllowanceForYear } from '../../core/accounting/trips';
import { formatDate, todayIso } from '../../core/dates';
import { formatEuro } from '../../core/money';
import type { Trip } from '../../core/types';
import { api } from '../api';
import type { PageProps } from '../App';
import { Empty, Field } from '../components/fields';

export function Trips({ db, reload, notify }: PageProps) {
  const blank = (): Trip => ({ id: '', date: todayIso(), from: db.settings.address.city, to: '', purpose: '', km: 0, rate: db.settings.kmRate });
  const [edit, setEdit] = useState<Trip>(blank());
  const [year, setYear] = useState(Number(todayIso().slice(0, 4)));
  const km = kmAllowanceForYear(db.trips, year);
  const trips = db.trips.filter((t) => t.date.startsWith(String(year))).sort((a, b) => b.date.localeCompare(a.date));
  const set = (p: Partial<Trip>) => setEdit({ ...edit, ...p });
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try { const r = await fn(); await reload(); if (ok) notify(ok); return r; } catch (e) { notify((e as Error).message, 'error'); return undefined; }
  };

  return (
    <div className="page">
      <header className="page-head">
        <h1>Fahrtenbuch</h1>
        <div className="actions">
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Jahr">
            {[...new Set([Number(todayIso().slice(0, 4)), ...db.trips.map((t) => Number(t.date.slice(0, 4)))])].sort((a, b) => b - a).map((y) => <option key={y}>{y}</option>)}
          </select>
          <button onClick={() => run(() => api.exportAccountingPdf('trips', year), 'Fahrtenbuch gespeichert.')}>Als PDF</button>
        </div>
      </header>
      <p className="muted">Dienstfahrten mit dem Privat-PKW werden mit dem amtlichen Kilometergeld abgesetzt (höchstens 30.000 km pro Jahr). Notieren Sie Datum, Strecke und Zweck jeder Fahrt.</p>

      <section className="figures three">
        <div><span>Kilometer {year}</span><strong>{km.km.toLocaleString('de-AT')}</strong></div>
        <div><span>Kilometergeld</span><strong>{formatEuro(km.amount)}</strong></div>
        <div><span>Noch verfügbar</span><strong>{(30_000 - km.km).toLocaleString('de-AT')} km</strong></div>
      </section>

      <section className="panel">
        <h2>{edit.id ? 'Fahrt bearbeiten' : 'Fahrt erfassen'}</h2>
        <div className="grid">
          <Field label="Datum"><input type="date" value={edit.date} onChange={(e) => set({ date: e.target.value })} /></Field>
          <Field label="Von"><input value={edit.from} onChange={(e) => set({ from: e.target.value })} /></Field>
          <Field label="Nach"><input value={edit.to} onChange={(e) => set({ to: e.target.value })} /></Field>
          <Field label="Kilometer (gesamt)"><input type="number" min={0} step="0.1" value={edit.km || ''} onChange={(e) => set({ km: Number(e.target.value) })} /></Field>
          <Field label="Zweck" wide><input value={edit.purpose} placeholder="z. B. Kundentermin Bäckerei Gruber" onChange={(e) => set({ purpose: e.target.value })} /></Field>
        </div>
        <div className="bar">
          <button className="primary" onClick={async () => { if (await run(() => api.saveTrip(edit), 'Fahrt gespeichert.')) setEdit(blank()); }}>Fahrt speichern</button>
          {edit.id && <button onClick={() => setEdit(blank())}>Abbrechen</button>}
          {edit.id && <button className="danger-text" onClick={async () => { await run(() => api.deleteTrip(edit.id)); setEdit(blank()); }}>Fahrt löschen</button>}
        </div>
      </section>

      {trips.length === 0 ? (
        <Empty>Noch keine Fahrten in {year}.</Empty>
      ) : (
        <table className="list">
          <thead><tr><th>Datum</th><th>Strecke</th><th>Zweck</th><th className="num">km</th><th className="num">Betrag</th></tr></thead>
          <tbody>
            {trips.map((t) => (
              <tr key={t.id} onClick={() => setEdit(t)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setEdit(t)}>
                <td>{formatDate(t.date)}</td><td>{t.from} – {t.to}</td><td>{t.purpose}</td>
                <td className="num">{t.km.toLocaleString('de-AT')}</td><td className="num">{formatEuro(Math.round(t.km * t.rate))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
