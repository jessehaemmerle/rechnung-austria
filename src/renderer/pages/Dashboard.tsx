import { todayIso, formatDate } from '../../core/dates';
import { paymentState, settingsFor } from '../../core/documents';
import { formatEuro } from '../../core/money';
import { checkSmallBusiness, SMALL_BUSINESS_LIMIT, SMALL_BUSINESS_TOLERANCE_LIMIT } from '../../core/smallBusiness';
import { openAmount } from '../../core/tax';
import { yearReport } from '../../core/reports';
import type { PageProps } from '../App';
import { Empty, StateBadge } from '../components/fields';

export function Dashboard({ db, go }: PageProps) {
  const today = todayIso();
  const year = Number(today.slice(0, 4));
  const report = yearReport(db, year);
  const sb = checkSmallBusiness(db.documents, db.settings, year);
  const open = db.documents
    .filter((d) => d.kind === 'invoice' && d.status === 'final')
    .map((d) => ({ d, state: paymentState(db, d, today), amount: openAmount(d, settingsFor(db, d)) }))
    .filter((x) => x.state === 'open' || x.state === 'partial' || x.state === 'overdue')
    .sort((a, b) => a.d.dueDate.localeCompare(b.d.dueDate));
  const overdueSum = open.filter((x) => x.state === 'overdue').reduce((s, x) => s + x.amount, 0);
  const openOffers = db.documents.filter((d) => d.kind === 'offer' && d.status === 'final' && d.offerStatus === 'open');
  const pct = Math.min(100, (sb.revenue / SMALL_BUSINESS_TOLERANCE_LIMIT) * 100);

  return (
    <div className="page">
      <header className="page-head">
        <h1>Übersicht {year}</h1>
      </header>

      <section className="figures">
        <div>
          <span>Umsatz brutto</span>
          <strong>{formatEuro(report.total.gross)}</strong>
        </div>
        <div>
          <span>Offen</span>
          <strong>{formatEuro(open.reduce((s, x) => s + x.amount, 0))}</strong>
        </div>
        <div className={overdueSum ? 'alert' : ''}>
          <span>Davon überfällig</span>
          <strong>{formatEuro(overdueSum)}</strong>
        </div>
        <div>
          <span>Offene Angebote</span>
          <strong>{openOffers.length}</strong>
        </div>
      </section>

      {db.settings.isSmallBusiness && (
        <section className={`panel limit ${sb.status}`}>
          <h2>Kleinunternehmergrenze</h2>
          <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={SMALL_BUSINESS_TOLERANCE_LIMIT} aria-valuenow={sb.revenue} aria-label="Umsatz im Verhältnis zur Toleranzgrenze">
            <div className="meter-fill" style={{ width: `${pct}%` }} />
            <div className="meter-mark" style={{ left: `${(SMALL_BUSINESS_LIMIT / SMALL_BUSINESS_TOLERANCE_LIMIT) * 100}%` }} title="55.000 €" />
          </div>
          <p>
            {formatEuro(sb.revenue)} von 55.000 € · {sb.remaining > 0 ? `noch ${formatEuro(sb.remaining)} Spielraum` : 'Grenze überschritten'}
          </p>
          <p className="muted">{sb.message}</p>
        </section>
      )}

      <section className="panel">
        <div className="panel-head">
          <h2>Offene Rechnungen</h2>
          <button className="primary" onClick={() => go({ page: 'invoices' })}>Alle Rechnungen</button>
        </div>
        {open.length === 0 ? (
          <Empty>Keine offenen Rechnungen. Alles bezahlt.</Empty>
        ) : (
          <table className="list">
            <thead>
              <tr><th>Nummer</th><th>Kunde</th><th>Fällig</th><th>Status</th><th className="num">Offen</th></tr>
            </thead>
            <tbody>
              {open.map(({ d, state, amount }) => (
                <tr key={d.id} onClick={() => go({ page: 'doc', id: d.id })} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && go({ page: 'doc', id: d.id })}>
                  <td>{d.number}</td>
                  <td>{d.customerSnapshot?.name}</td>
                  <td>{formatDate(d.dueDate)}</td>
                  <td><StateBadge state={state} /></td>
                  <td className="num">{formatEuro(amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
