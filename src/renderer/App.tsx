import { useCallback, useEffect, useState } from 'react';
import type { Database } from '../core/types';
import { api } from './api';
import { Toasts, useToast } from './components/Toast';
import { Articles } from './pages/Articles';
import { Customers } from './pages/Customers';
import { Dashboard } from './pages/Dashboard';
import { DocumentEditor } from './pages/DocumentEditor';
import { DocumentList } from './pages/DocumentList';
import { Reports } from './pages/Reports';
import { Settings } from './pages/Settings';

export type Route =
  | { page: 'dashboard' }
  | { page: 'invoices' }
  | { page: 'offers' }
  | { page: 'customers' }
  | { page: 'articles' }
  | { page: 'reports' }
  | { page: 'settings' }
  | { page: 'doc'; id: string };

export interface PageProps {
  db: Database;
  reload: () => Promise<void>;
  go: (r: Route) => void;
  notify: (msg: string, kind?: 'ok' | 'error') => void;
}

const NAV: { page: Route['page']; label: string }[] = [
  { page: 'dashboard', label: 'Übersicht' },
  { page: 'invoices', label: 'Rechnungen' },
  { page: 'offers', label: 'Angebote' },
  { page: 'customers', label: 'Kunden' },
  { page: 'articles', label: 'Leistungen' },
  { page: 'reports', label: 'Auswertungen' },
  { page: 'settings', label: 'Einstellungen' },
];

export function App() {
  const [db, setDb] = useState<Database | null>(null);
  const [route, setRoute] = useState<Route>({ page: 'dashboard' });
  const { toasts, notify } = useToast();

  const reload = useCallback(async () => setDb(await api.getDb()), []);
  useEffect(() => {
    reload().catch((e) => notify(e.message, 'error'));
  }, [reload, notify]);

  if (!db) return <div className="loading">Daten werden geladen …</div>;

  const props: PageProps = { db, reload, go: setRoute, notify };
  const setupMissing = !db.settings.name || !db.settings.address.street;
  const activeNav =
    route.page === 'doc' ? (db.documents.find((d) => d.id === route.id)?.kind === 'offer' ? 'offers' : 'invoices') : route.page;

  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Hauptnavigation">
        <div className="brand">
          <span className="brand-mark" aria-hidden>€</span>
          <span>
            <strong>{db.settings.name || 'Rechnung Austria'}</strong>
            <small>{db.settings.isSmallBusiness ? 'Kleinunternehmer' : 'Regelbesteuerung'}</small>
          </span>
        </div>
        {NAV.map((n) => (
          <button key={n.page} className={activeNav === n.page ? 'nav active' : 'nav'} onClick={() => setRoute({ page: n.page } as Route)}>
            {n.label}
          </button>
        ))}
      </nav>
      <main className="content">
        {setupMissing && route.page !== 'settings' && (
          <div className="banner">
            Bevor Sie Rechnungen schreiben: Firmendaten und Anschrift fehlen noch.{' '}
            <button className="link" onClick={() => setRoute({ page: 'settings' })}>Firmendaten eintragen</button>
          </div>
        )}
        {route.page === 'dashboard' && <Dashboard {...props} />}
        {route.page === 'invoices' && <DocumentList {...props} kind="invoice" />}
        {route.page === 'offers' && <DocumentList {...props} kind="offer" />}
        {route.page === 'customers' && <Customers {...props} />}
        {route.page === 'articles' && <Articles {...props} />}
        {route.page === 'reports' && <Reports {...props} />}
        {route.page === 'settings' && <Settings {...props} />}
        {route.page === 'doc' && <DocumentEditor key={route.id} {...props} id={route.id} />}
      </main>
      <Toasts toasts={toasts} />
    </div>
  );
}
