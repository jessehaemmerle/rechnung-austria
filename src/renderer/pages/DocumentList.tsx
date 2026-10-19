import { useMemo, useState } from 'react';
import { formatDate, todayIso } from '../../core/dates';
import { paymentState, settingsFor } from '../../core/documents';
import { formatEuro } from '../../core/money';
import { computeTotals } from '../../core/tax';
import type { OfferStatus } from '../../core/types';
import { api } from '../api';
import type { PageProps } from '../App';
import { Empty, StateBadge } from '../components/fields';

const OFFER_LABEL: Record<OfferStatus, string> = { open: 'Offen', accepted: 'Angenommen', rejected: 'Abgelehnt', invoiced: 'Verrechnet' };

export function DocumentList({ db, go, notify, reload, kind }: PageProps & { kind: 'invoice' | 'offer' }) {
  const [customerId, setCustomerId] = useState('');
  const [query, setQuery] = useState('');
  const [year, setYear] = useState<string>(todayIso().slice(0, 4));
  const today = todayIso();
  const isOffer = kind === 'offer';

  const years = useMemo(() => [...new Set(db.documents.map((d) => d.issueDate.slice(0, 4)))].sort().reverse(), [db.documents]);
  const docs = db.documents
    .filter((d) => (isOffer ? d.kind === 'offer' : d.kind !== 'offer'))
    .filter((d) => !year || d.issueDate.startsWith(year))
    .filter((d) => {
      const name = d.customerSnapshot?.name ?? db.customers.find((c) => c.id === d.customerId)?.name ?? '';
      const q = query.toLowerCase();
      return !q || d.number.toLowerCase().includes(q) || name.toLowerCase().includes(q) || d.title.toLowerCase().includes(q);
    })
    .sort((a, b) => (a.status === 'draft' ? -1 : 0) - (b.status === 'draft' ? -1 : 0) || b.issueDate.localeCompare(a.issueDate) || b.number.localeCompare(a.number));

  const create = async () => {
    if (!customerId) return notify('Bitte zuerst einen Kunden auswählen.', 'error');
    try {
      const d = await api.createDoc(kind, customerId);
      await reload();
      go({ page: 'doc', id: d.id });
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  };

  return (
    <div className="page">
      <header className="page-head">
        <h1>{isOffer ? 'Angebote' : 'Rechnungen'}</h1>
        <div className="actions">
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} aria-label="Kunde für neues Dokument">
            <option value="">Kunde wählen …</option>
            {db.customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button className="primary" onClick={create} disabled={!customerId}>
            {isOffer ? 'Angebot erstellen' : 'Rechnung erstellen'}
          </button>
        </div>
      </header>
      {db.customers.length === 0 && (
        <div className="banner">
          Legen Sie zuerst einen Kunden an. <button className="link" onClick={() => go({ page: 'customers' })}>Kunden anlegen</button>
        </div>
      )}
      <div className="filters">
        <input type="search" placeholder="Nummer, Kunde oder Titel suchen" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Suchen" />
        <select value={year} onChange={(e) => setYear(e.target.value)} aria-label="Jahr">
          <option value="">Alle Jahre</option>
          {[...new Set([todayIso().slice(0, 4), ...years])].map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>
      {docs.length === 0 ? (
        <Empty>{isOffer ? 'Noch keine Angebote in diesem Zeitraum.' : 'Noch keine Rechnungen in diesem Zeitraum.'}</Empty>
      ) : (
        <table className="list">
          <thead>
            <tr>
              <th>Nummer</th><th>Datum</th><th>Kunde</th><th>Titel</th><th>Status</th><th className="num">Brutto</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => {
              const c = d.customerSnapshot ?? db.customers.find((x) => x.id === d.customerId);
              const gross = computeTotals(d, settingsFor(db, d)).gross;
              return (
                <tr key={d.id} onClick={() => go({ page: 'doc', id: d.id })} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && go({ page: 'doc', id: d.id })}>
                  <td>{d.number || <em className="muted">Entwurf</em>}{d.kind === 'credit_note' && <span className="tag">Storno</span>}</td>
                  <td>{formatDate(d.issueDate)}</td>
                  <td>{c?.name}</td>
                  <td>{d.title}</td>
                  <td>
                    {isOffer ? (d.status === 'draft' ? <StateBadge state="draft" /> : <span className={`badge offer-${d.offerStatus}`}>{OFFER_LABEL[d.offerStatus ?? 'open']}</span>)
                      : <StateBadge state={d.kind === 'credit_note' && d.status !== 'draft' ? 'cancelled' : paymentState(db, d, today)} />}
                  </td>
                  <td className="num">{formatEuro(gross)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
