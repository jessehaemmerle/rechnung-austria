import { useState } from 'react';
import { formatEuro } from '../../core/money';
import type { Article, VatRate } from '../../core/types';
import { api } from '../api';
import type { PageProps } from '../App';
import { Empty, Field, MoneyInput } from '../components/fields';

export function Articles({ db, reload, notify }: PageProps) {
  const [edit, setEdit] = useState<Article | null>(null);
  const set = (p: Partial<Article>) => edit && setEdit({ ...edit, ...p });

  const save = async () => {
    if (!edit?.name.trim()) return notify('Bitte eine Bezeichnung eingeben.', 'error');
    await api.saveArticle(edit);
    await reload();
    setEdit(null);
    notify('Leistung gespeichert.');
  };

  return (
    <div className="page">
      <header className="page-head">
        <h1>Leistungen</h1>
        <button className="primary" onClick={() => setEdit({ id: '', name: '', description: '', unit: 'h', unitPrice: 0, vatRate: 20 })}>Leistung anlegen</button>
      </header>
      <p className="muted">Wiederkehrende Leistungen und Produkte, die Sie mit einem Klick in Angebote und Rechnungen übernehmen.</p>
      {edit && (
        <section className="panel">
          <div className="grid">
            <Field label="Bezeichnung" wide><input autoFocus value={edit.name} onChange={(e) => set({ name: e.target.value })} /></Field>
            <Field label="Beschreibung" wide><textarea rows={2} value={edit.description} onChange={(e) => set({ description: e.target.value })} /></Field>
            <Field label="Einheit"><input value={edit.unit} onChange={(e) => set({ unit: e.target.value })} /></Field>
            <Field label="Preis netto (€)"><MoneyInput value={edit.unitPrice} onChange={(c) => set({ unitPrice: c })} /></Field>
            {!db.settings.isSmallBusiness && (
              <Field label="USt-Satz">
                <select value={edit.vatRate} onChange={(e) => set({ vatRate: Number(e.target.value) as VatRate })}>
                  {[20, 13, 10, 0].map((r) => <option key={r} value={r}>{r} %</option>)}
                </select>
              </Field>
            )}
          </div>
          <div className="bar">
            <button className="primary" onClick={save}>Leistung speichern</button>
            <button onClick={() => setEdit(null)}>Abbrechen</button>
            {edit.id && <button className="danger-text" onClick={async () => { await api.deleteArticle(edit.id); await reload(); setEdit(null); }}>Leistung löschen</button>}
          </div>
        </section>
      )}
      {db.articles.length === 0 ? (
        <Empty>Noch keine Leistungen im Katalog.</Empty>
      ) : (
        <table className="list">
          <thead><tr><th>Bezeichnung</th><th>Einheit</th>{!db.settings.isSmallBusiness && <th>USt</th>}<th className="num">Preis netto</th></tr></thead>
          <tbody>
            {db.articles.map((a) => (
              <tr key={a.id} onClick={() => setEdit(a)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setEdit(a)}>
                <td>{a.name}</td><td>{a.unit}</td>{!db.settings.isSmallBusiness && <td>{a.vatRate} %</td>}<td className="num">{formatEuro(a.unitPrice)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
