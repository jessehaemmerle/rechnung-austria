import { useState } from 'react';
import { isEuCountry, isValidVatIdFormat } from '../../core/compliance';
import type { Customer } from '../../core/types';
import { api } from '../api';
import type { PageProps } from '../App';
import { Empty, Field } from '../components/fields';

const blank = (lang: 'de' | 'en'): Customer => ({
  id: '',
  number: '',
  name: '',
  contactPerson: '',
  address: { street: '', zip: '', city: '', country: 'AT' },
  email: '',
  vatId: '',
  isBusiness: true,
  language: lang,
  buyerReference: '',
  notes: '',
});

export function Customers({ db, reload, notify }: PageProps) {
  const [edit, setEdit] = useState<Customer | null>(null);
  const [query, setQuery] = useState('');

  const save = async () => {
    if (!edit) return;
    if (!edit.name.trim()) return notify('Bitte einen Namen eingeben.', 'error');
    try {
      await api.saveCustomer({ ...edit, address: { ...edit.address, country: edit.address.country.toUpperCase() }, vatId: edit.vatId.replace(/\s/g, '').toUpperCase() });
      await reload();
      setEdit(null);
      notify('Kunde gespeichert.');
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  };
  const set = (patch: Partial<Customer>) => edit && setEdit({ ...edit, ...patch });
  const setAddr = (patch: Partial<Customer['address']>) => edit && setEdit({ ...edit, address: { ...edit.address, ...patch } });

  const list = db.customers.filter((c) => !query || `${c.name} ${c.number} ${c.address.city}`.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="page">
      <header className="page-head">
        <h1>Kunden</h1>
        <button className="primary" onClick={() => setEdit(blank(db.settings.defaultLanguage))}>Kunden anlegen</button>
      </header>

      {edit && (
        <section className="panel">
          <h2>{edit.id ? `${edit.name} bearbeiten` : 'Neuer Kunde'}</h2>
          <div className="grid">
            <Field label="Name / Firma" wide><input autoFocus value={edit.name} onChange={(e) => set({ name: e.target.value })} /></Field>
            <Field label="Ansprechperson"><input value={edit.contactPerson} onChange={(e) => set({ contactPerson: e.target.value })} /></Field>
            <Field label="E-Mail"><input type="email" value={edit.email} onChange={(e) => set({ email: e.target.value })} /></Field>
            <Field label="Straße und Hausnummer" wide><input value={edit.address.street} onChange={(e) => setAddr({ street: e.target.value })} /></Field>
            <Field label="PLZ"><input value={edit.address.zip} onChange={(e) => setAddr({ zip: e.target.value })} /></Field>
            <Field label="Ort"><input value={edit.address.city} onChange={(e) => setAddr({ city: e.target.value })} /></Field>
            <Field label="Land" hint="Ländercode, z. B. AT, DE"><input maxLength={2} value={edit.address.country} onChange={(e) => setAddr({ country: e.target.value.toUpperCase() })} /></Field>
            <Field label="Kundenart">
              <select value={edit.isBusiness ? 'b2b' : 'b2c'} onChange={(e) => set({ isBusiness: e.target.value === 'b2b' })}>
                <option value="b2b">Unternehmen</option>
                <option value="b2c">Privatperson</option>
              </select>
            </Field>
            <Field
              label="UID-Nummer"
              hint={edit.vatId && !isValidVatIdFormat(edit.vatId) ? 'Format ungültig' : edit.address.country !== 'AT' && isEuCountry(edit.address.country) && edit.isBusiness ? 'Für Reverse Charge erforderlich' : undefined}
            >
              <input value={edit.vatId} onChange={(e) => set({ vatId: e.target.value })} />
            </Field>
            <Field label="Dokumentsprache">
              <select value={edit.language} onChange={(e) => set({ language: e.target.value as 'de' | 'en' })}>
                <option value="de">Deutsch</option>
                <option value="en">Englisch</option>
              </select>
            </Field>
            <Field label="Auftragsreferenz / Leitweg-ID" hint="Für E-Rechnungen an öffentliche Stellen"><input value={edit.buyerReference} onChange={(e) => set({ buyerReference: e.target.value })} /></Field>
            <Field label="Notizen" wide><textarea rows={2} value={edit.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
          </div>
          <div className="bar">
            <button className="primary" onClick={save}>Kunden speichern</button>
            <button onClick={() => setEdit(null)}>Abbrechen</button>
            {edit.id && (
              <button
                className="danger-text"
                onClick={async () => {
                  if (!window.confirm(`${edit.name} löschen?`)) return;
                  try {
                    await api.deleteCustomer(edit.id);
                    await reload();
                    setEdit(null);
                  } catch (e) {
                    notify((e as Error).message, 'error');
                  }
                }}
              >
                Kunden löschen
              </button>
            )}
          </div>
        </section>
      )}

      <div className="filters">
        <input type="search" placeholder="Kunden suchen" aria-label="Kunden suchen" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {list.length === 0 ? (
        <Empty>Noch keine Kunden. Legen Sie Ihren ersten Kunden an, um ein Angebot oder eine Rechnung zu schreiben.</Empty>
      ) : (
        <table className="list">
          <thead><tr><th>Nr.</th><th>Name</th><th>Ort</th><th>UID</th><th>Art</th></tr></thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.id} onClick={() => setEdit(c)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setEdit(c)}>
                <td>{c.number}</td><td>{c.name}</td><td>{c.address.zip} {c.address.city} {c.address.country !== 'AT' && c.address.country}</td>
                <td>{c.vatId}</td><td>{c.isBusiness ? 'Unternehmen' : 'Privat'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
