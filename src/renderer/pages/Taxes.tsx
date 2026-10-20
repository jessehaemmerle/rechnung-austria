import { useState } from 'react';
import { e1aSummary, earReport } from '../../core/accounting/ear';
import { estimateTaxes } from '../../core/accounting/estimate';
import { computeUva, periodsOfYear, vatDueDate } from '../../core/accounting/vat';
import { formatDate, todayIso } from '../../core/dates';
import { formatEuro } from '../../core/money';
import { api } from '../api';
import type { PageProps } from '../App';
import { Field } from '../components/fields';

export function Taxes({ db, notify }: PageProps) {
  const current = Number(todayIso().slice(0, 4));
  const [year, setYear] = useState(current);
  const [datev, setDatev] = useState({ consultant: '', client: '' });
  const years = [...new Set([current, current - 1, ...db.documents.map((d) => Number(d.issueDate.slice(0, 4))), ...db.entries.map((e) => Number(e.date.slice(0, 4)))])].sort((a, b) => b - a);
  const ear = earReport(db, year);
  const est = estimateTaxes(ear.profit, ear.svsPaid, year, db.settings.svsInsured);
  const periods = periodsOfYear(year, db.settings.vatPeriod);
  const today = todayIso();
  const save = (p: Promise<string | null>, ok: string) => p.then((r) => r && notify(ok)).catch((e) => notify(e.message, 'error'));
  const unlinked = db.bankTransactions.filter((t) => !t.link && t.date.startsWith(String(year))).length;
  const noReceipt = db.entries.filter((e) => e.kind === 'expense' && !e.receipts.length && e.date.startsWith(String(year))).length;

  return (
    <div className="page">
      <header className="page-head">
        <h1>Steuern {year}</h1>
        <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Jahr">
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </header>

      {(unlinked > 0 || noReceipt > 0 || ear.warnings.length > 0) && (
        <section className="checks">
          <h2>Offene Punkte vor dem Abschluss</h2>
          <ul>
            {unlinked > 0 && <li className="warning">{unlinked === 1 ? '1 Bankbewegung ist' : `${unlinked} Bankbewegungen sind`} noch nicht zugeordnet.</li>}
            {noReceipt > 0 && <li className="warning">{noReceipt === 1 ? '1 Ausgabe hat' : `${noReceipt} Ausgaben haben`} keinen Beleg.</li>}
            {ear.warnings.map((w) => <li key={w} className="warning">{w}</li>)}
          </ul>
        </section>
      )}

      {!db.settings.isSmallBusiness && (
        <section className="panel">
          <div className="panel-head">
            <h2>Umsatzsteuervoranmeldung ({db.settings.vatPeriod === 'monthly' ? 'monatlich' : 'vierteljährlich'}, {db.settings.taxationBasis === 'ist' ? 'Ist' : 'Soll'}-Besteuerung)</h2>
          </div>
          <table className="list">
            <thead><tr><th>Zeitraum</th><th>Fällig</th><th className="num">Umsatz netto</th><th className="num">USt</th><th className="num">Vorsteuer</th><th className="num">Zahllast</th><th /></tr></thead>
            <tbody>
              {periods.map((p) => {
                const u = computeUva(db, p);
                const tax = u.vat20 + u.vat10 + u.vat13 + u.kz057 + u.kz072 + u.kz073 + u.kz008;
                const due = vatDueDate(p);
                return (
                  <tr key={p.index} className={p.from > today ? 'future' : ''}>
                    <td>{p.label}</td>
                    <td className={due < today ? '' : 'strong'}>{formatDate(due)}</td>
                    <td className="num">{formatEuro(u.kz000)}</td>
                    <td className="num">{formatEuro(tax)}</td>
                    <td className="num">{formatEuro(u.kz060 + u.kz065 + u.kz066)}</td>
                    <td className={`num ${u.payable < 0 ? 'pos' : ''}`}>{formatEuro(u.payable)}</td>
                    <td><button className="link" onClick={() => save(api.exportAccountingPdf('uva', year, p.index), 'UVA gespeichert.')}>PDF mit Kennzahlen</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="muted">Bei einem Vorjahresumsatz bis 35.000 € muss die UVA nicht eingereicht werden, wenn die Vorauszahlung pünktlich bezahlt wird oder sich keine ergibt. Abgabe über FinanzOnline.</p>
        </section>
      )}

      <section className="panel">
        <div className="panel-head">
          <h2>Einnahmen-Ausgaben-Rechnung</h2>
          <button onClick={() => save(api.exportAccountingPdf('ear', year), 'E/A-Rechnung gespeichert.')}>Als PDF</button>
        </div>
        <section className="figures">
          <div><span>Einnahmen</span><strong>{formatEuro(ear.totalIncome)}</strong></div>
          <div><span>Ausgaben</span><strong>{formatEuro(ear.totalExpenses)}</strong></div>
          <div><span>Gewinn</span><strong>{formatEuro(ear.profit)}</strong></div>
          <div><span>Nach Grundfreibetrag</span><strong>{formatEuro(ear.taxableProfit)}</strong></div>
        </section>
        <table className="list">
          <thead><tr><th>KZ</th><th>E1a-Position</th><th className="num">Betrag</th></tr></thead>
          <tbody>
            {e1aSummary(ear).map((l) => <tr key={l.e1a}><td>{l.e1a}</td><td>{l.label}</td><td className="num">{formatEuro(l.amount)}</td></tr>)}
            <tr className="total-row"><td /><td>Grundfreibetrag (15 % bis 33.000 €)</td><td className="num">{formatEuro(-ear.basicAllowance)}</td></tr>
          </tbody>
        </table>
        <p className="muted">Kennzahlen bitte mit dem aktuellen Formular E1a abgleichen. Einnahmen zählen bei Zahlungseingang, Ausgaben bei Bezahlung (Zufluss-/Abflussprinzip).</p>
      </section>

      <section className="panel">
        <h2>Rücklage für Einkommensteuer und SVS</h2>
        <section className="figures three">
          <div><span>Einkommensteuer (Tarif {est.tariffYear})</span><strong>{formatEuro(est.incomeTax)}</strong></div>
          <div><span>SVS geschätzt / bezahlt</span><strong>{formatEuro(est.svs.total)} / {formatEuro(ear.svsPaid)}</strong></div>
          <div className="alert"><span>Empfohlene Rücklage</span><strong>{formatEuro(est.reserve)}</strong></div>
        </section>
        <p className="muted">
          Grobe Schätzung ohne andere Einkünfte, Absetzbeträge, Sonderausgaben und bereits geleistete ESt-Vorauszahlungen. SVS: KV 6,8 %, PV 18,5 %, Vorsorge 1,53 % der Beitragsgrundlage
          ({formatEuro(est.svs.base)}) plus Unfallversicherung; Werte 2025.
        </p>
      </section>

      <section className="panel">
        <h2>Export für die Steuerberatung</h2>
        <p className="muted">Buchungsjournal {year} nach Zahlungsfluss mit Kontenrahmen EKR. Konten können in den Einstellungen angepasst werden.</p>
        <div className="bar">
          <button className="primary" onClick={() => save(api.exportBmd(year), 'BMD-Export gespeichert.')}>BMD-Buchungsimport (CSV)</button>
          <button onClick={() => save(api.exportCsv(year), 'Rechnungsliste gespeichert.')}>Rechnungsliste (CSV)</button>
          <button onClick={() => save(api.exportAccountingPdf('assets', year), 'Anlagenverzeichnis gespeichert.')}>Anlagenverzeichnis</button>
        </div>
        <div className="inline-form">
          <Field label="DATEV Beraternummer"><input value={datev.consultant} onChange={(e) => setDatev({ ...datev, consultant: e.target.value.replace(/\D/g, '') })} /></Field>
          <Field label="Mandantennummer"><input value={datev.client} onChange={(e) => setDatev({ ...datev, client: e.target.value.replace(/\D/g, '') })} /></Field>
          <button onClick={() => save(api.exportDatev(year, datev), 'DATEV-Export gespeichert.')}>DATEV-Buchungsstapel</button>
        </div>
      </section>
    </div>
  );
}
