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
import { Assets } from './pages/Assets';
import { Bank } from './pages/Bank';
import { Entries } from './pages/Entries';
import { Taxes } from './pages/Taxes';
import { Trips } from './pages/Trips';

export type Route =
  | { page: 'dashboard' }
  | { page: 'invoices' }
  | { page: 'offers' }
  | { page: 'customers' }
  | { page: 'articles' }
  | { page: 'reports' }
  | { page: 'settings' }
  | { page: 'entries' }
  | { page: 'bank' }
  | { page: 'assets' }
  | { page: 'trips' }
  | { page: 'taxes' }
  | { page: 'doc'; id: string };

export interface PageProps {
  db: Database;
  reload: () => Promise<void>;
  go: (r: Route) => void;
  notify: (msg: string, kind?: 'ok' | 'error') => void;
}

const NAV: { group?: string; page: Route['page']; label: string }[] = [
  { page: 'dashboard', label: 'Übersicht' },
  { group: 'Verkauf', page: 'invoices', label: 'Rechnungen' },
  { page: 'offers', label: 'Angebote' },
  { page: 'customers', label: 'Kunden' },
  { page: 'articles', label: 'Leistungen' },
  { group: 'Buchhaltung', page: 'bank', label: 'Bank & Kassa' },
  { page: 'entries', label: 'Ausgaben & Belege' },
  { page: 'assets', label: 'Anlagen' },
  { page: 'trips', label: 'Fahrtenbuch' },
  { page: 'taxes', label: 'Steuern' },
  { group: '', page: 'reports', label: 'Auswertungen' },
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
          <div key={n.page} className="nav-item">
            {n.group !== undefined && (n.group ? <div className="nav-group">{n.group}</div> : <div className="nav-gap" />)}
            <button className={activeNav === n.page ? 'nav active' : 'nav'} onClick={() => setRoute({ page: n.page } as Route)}>
              {n.label}
            </button>
          </div>
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
        {route.page === 'entries' && <Entries {...props} />}
        {route.page === 'bank' && <Bank {...props} />}
        {route.page === 'assets' && <Assets {...props} />}
        {route.page === 'trips' && <Trips {...props} />}
        {route.page === 'taxes' && <Taxes {...props} />}
        {route.page === 'doc' && <DocumentEditor key={route.id} {...props} id={route.id} />}
      </main>
      <Toasts toasts={toasts} />
    </div>
  );
}
