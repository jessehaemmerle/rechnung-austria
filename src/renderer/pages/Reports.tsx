import { useState } from 'react';
import { todayIso } from '../../core/dates';
import { formatEuro } from '../../core/money';
import { yearReport } from '../../core/reports';
import { checkSmallBusiness } from '../../core/smallBusiness';
import { api } from '../api';
import type { PageProps } from '../App';

const MONTHS = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

export function Reports({ db, notify }: PageProps) {
  const current = Number(todayIso().slice(0, 4));
  const [year, setYear] = useState(current);
  const r = yearReport(db, year);
  const sb = checkSmallBusiness(db.documents, db.settings, year);
  const max = Math.max(1, ...r.months.map((m) => m.gross));
  const years = [...new Set([current, ...db.documents.map((d) => Number(d.issueDate.slice(0, 4)))])].sort((a, b) => b - a);

  return (
    <div className="page">
      <header className="page-head">
        <h1>Auswertungen</h1>
        <div className="actions">
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Jahr">
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <button className="primary" onClick={() => api.exportCsv(year).then((p) => p && notify('CSV gespeichert.')).catch((e) => notify(e.message, 'error'))}>
            CSV für Steuerberatung
          </button>
        </div>
      </header>

      <section className="figures">
        <div><span>Netto</span><strong>{formatEuro(r.total.net)}</strong></div>
        <div><span>Umsatzsteuer</span><strong>{formatEuro(r.total.vat)}</strong></div>
        <div><span>Brutto</span><strong>{formatEuro(r.total.gross)}</strong></div>
        <div><span>Noch offen</span><strong>{formatEuro(r.total.open)}</strong></div>
      </section>

      <section className="panel">
        <h2>Umsatz je Monat (brutto, nach Rechnungsdatum)</h2>
        <table className="list months">
          <thead><tr><th>Monat</th><th className="bar-col" /><th className="num">Netto</th><th className="num">USt</th><th className="num">Brutto</th><th className="num">Bezahlt</th></tr></thead>
          <tbody>
            {r.months.map((m) => (
              <tr key={m.month}>
                <td>{MONTHS[m.month - 1]}</td>
                <td className="bar-col"><div className="hbar" style={{ width: `${(Math.max(0, m.gross) / max) * 100}%` }} /></td>
                <td className="num">{formatEuro(m.net)}</td><td className="num">{formatEuro(m.vat)}</td>
                <td className="num">{formatEuro(m.gross)}</td><td className="num">{formatEuro(m.paid)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>Für die Umsatzsteuervoranmeldung / Jahreserklärung</h2>
        <table className="list">
          <tbody>
            {r.byRate.map((g) => (
              <tr key={g.rate}><td>Steuerpflichtig {g.rate} %</td><td className="num">{formatEuro(g.net)} netto</td><td className="num">{formatEuro(g.vat)} USt</td></tr>
            ))}
            {r.smallBusinessNet !== 0 && <tr><td>Steuerfrei, Kleinunternehmer (§ 6 Abs 1 Z 27)</td><td className="num">{formatEuro(r.smallBusinessNet)}</td><td /></tr>}
            {r.reverseChargeNet !== 0 && <tr><td>EU-Leistungen Reverse Charge (Zusammenfassende Meldung)</td><td className="num">{formatEuro(r.reverseChargeNet)}</td><td /></tr>}
            {r.igDeliveryNet !== 0 && <tr><td>Innergemeinschaftliche Lieferungen (Zusammenfassende Meldung)</td><td className="num">{formatEuro(r.igDeliveryNet)}</td><td /></tr>}
          </tbody>
        </table>
        <p className="muted">
          Kleinunternehmerprüfung nach Leistungsdatum: {formatEuro(sb.revenue)} – {sb.message} Diese Übersicht ersetzt keine Steuerberatung.
        </p>
      </section>
    </div>
  );
}
