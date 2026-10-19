import { useEffect, useMemo, useState } from 'react';
import { checkInvoice, isSmallAmountInvoice } from '../../core/compliance';
import { formatDate, todayIso } from '../../core/dates';
import { isOverdue, nextDunningLevel } from '../../core/dunning';
import { newLineItem, paymentState, settingsFor } from '../../core/documents';
import { kindLabel } from '../../core/i18n';
import { formatEuro } from '../../core/money';
import { wouldExceedTolerance } from '../../core/smallBusiness';
import { computeTotals, openAmount, paidAmount } from '../../core/tax';
import { renderDocumentHtml } from '../../core/template';
import type { BusinessDocument, LineItem, TaxCase, VatRate } from '../../core/types';
import type { EInvoiceFormat } from '../../preload/api';
import { api } from '../api';
import type { PageProps } from '../App';
import { Field, MoneyInput, StateBadge } from '../components/fields';
import { PaperPreview } from '../components/PaperPreview';

const TAX_CASES: { value: TaxCase; label: string }[] = [
  { value: 'domestic', label: 'Inland' },
  { value: 'reverse_charge', label: 'EU-Leistung, Reverse Charge' },
  { value: 'ig_delivery', label: 'Innergemeinschaftliche Lieferung' },
];

export function DocumentEditor({ db, reload, go, notify, id }: PageProps & { id: string }) {
  const stored = db.documents.find((d) => d.id === id);
  const [doc, setDoc] = useState<BusinessDocument | undefined>(stored);
  const [dirty, setDirty] = useState(false);
  const [payment, setPayment] = useState({ date: todayIso(), amount: 0, note: '' });
  const [dunOpts, setDunOpts] = useState({ chargeInterest: true, applyCollectionFee: false });

  useEffect(() => {
    if (!dirty) setDoc(stored);
  }, [stored, dirty]);

  const settings = doc ? settingsFor(db, doc) : db.settings;
  const customer = doc ? doc.customerSnapshot ?? db.customers.find((c) => c.id === doc.customerId) : undefined;
  const source = doc?.sourceDocumentId ? db.documents.find((d) => d.id === doc.sourceDocumentId) : undefined;
  const html = useMemo(
    () => (doc ? renderDocumentHtml({ doc, settings, customer, sourceNumber: source?.number }) : ''),
    [doc, settings, customer, source?.number],
  );

  if (!doc) return <div className="page"><p>Dokument nicht gefunden.</p></div>;

  const isDraft = doc.status === 'draft';
  const isOffer = doc.kind === 'offer';
  const totals = computeTotals(doc, settings);
  const issues = isDraft ? checkInvoice(doc, settings, customer) : [];
  const exceed = isDraft && !isOffer && wouldExceedTolerance(db.documents, doc, settings);
  const state = paymentState(db, doc);
  const listPage = isOffer ? 'offers' : 'invoices';

  const update = (patch: Partial<BusinessDocument>) => {
    setDoc({ ...doc, ...patch });
    setDirty(true);
  };
  const updateItem = (itemId: string, patch: Partial<LineItem>) =>
    update({ items: doc.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)) });
  const moveItem = (index: number, dir: -1 | 1) => {
    const items = [...doc.items];
    const [it] = items.splice(index, 1);
    items.splice(index + dir, 0, it);
    update({ items });
  };

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      const res = await fn();
      await reload();
      if (ok && res !== null && res !== false) notify(ok);
      return res;
    } catch (e) {
      notify((e as Error).message, 'error');
      return undefined;
    }
  };
  const save = async () => {
    const r = await run(() => api.saveDoc(doc), 'Entwurf gespeichert.');
    if (r) setDirty(false);
    return r;
  };
  const finalize = async () => {
    const label = isOffer ? 'Angebot' : 'Rechnung';
    if (!window.confirm(`${label} jetzt finalisieren? Danach erhält sie eine fortlaufende Nummer und kann nicht mehr geändert werden.`)) return;
    if (dirty && !(await save())) return;
    setDirty(false);
    await run(() => api.finalizeDoc(doc.id), `${label} finalisiert.`);
  };
  const exportE = (format: EInvoiceFormat) => run(() => api.exportEInvoice(doc.id, format), 'Datei gespeichert.');

  return (
    <div className="editor">
      <div className="editor-form">
        <header className="page-head">
          <div>
            <button className="link" onClick={() => go({ page: listPage })}>Zurück zur Liste</button>
            <h1>
              {kindLabel(doc.kind, 'de')} {doc.number || '(Entwurf)'}
            </h1>
          </div>
          <StateBadge state={state} />
        </header>

        {exceed && (
          <div className="banner error">
            Mit dieser Rechnung überschreiten Sie die Toleranzgrenze von 60.500 €. Ab diesem Umsatz ist Umsatzsteuer zu verrechnen –
            stellen Sie in den Einstellungen auf Regelbesteuerung um und sprechen Sie mit Ihrer Steuerberatung.
          </div>
        )}

        <fieldset disabled={!isDraft} className="grid">
          <Field label="Kunde">
            <select value={doc.customerId} onChange={(e) => update({ customerId: e.target.value, language: db.customers.find((c) => c.id === e.target.value)?.language ?? doc.language })}>
              {db.customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Steuerfall">
            <select value={doc.taxCase} onChange={(e) => update({ taxCase: e.target.value as TaxCase })}>
              {TAX_CASES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Sprache">
            <select value={doc.language} onChange={(e) => update({ language: e.target.value as 'de' | 'en' })}>
              <option value="de">Deutsch</option>
              <option value="en">Englisch</option>
            </select>
          </Field>
          <Field label={isOffer ? 'Angebotsdatum' : 'Rechnungsdatum'}>
            <input type="date" value={doc.issueDate} onChange={(e) => update({ issueDate: e.target.value })} />
          </Field>
          {isOffer ? (
            <Field label="Gültig bis">
              <input type="date" value={doc.validUntil} onChange={(e) => update({ validUntil: e.target.value })} />
            </Field>
          ) : (
            <>
              <Field label="Leistung von">
                <input type="date" value={doc.serviceDateFrom} onChange={(e) => update({ serviceDateFrom: e.target.value })} />
              </Field>
              <Field label="Leistung bis" hint="Nur bei Leistungszeitraum">
                <input type="date" value={doc.serviceDateTo} onChange={(e) => update({ serviceDateTo: e.target.value })} />
              </Field>
              <Field label="Zahlbar bis">
                <input type="date" value={doc.dueDate} onChange={(e) => update({ dueDate: e.target.value })} />
              </Field>
            </>
          )}
          <Field label="Titel" wide>
            <input value={doc.title} placeholder={isOffer ? 'z. B. Angebot Website-Relaunch' : 'z. B. Webdesign März 2026'} onChange={(e) => update({ title: e.target.value })} />
          </Field>
          <Field label="Einleitungstext" wide>
            <textarea rows={2} value={doc.introText} onChange={(e) => update({ introText: e.target.value })} />
          </Field>
        </fieldset>

        <section className="items">
          <h2>Positionen</h2>
          <table className="item-table">
            <thead>
              <tr>
                <th>Bezeichnung</th><th className="num">Menge</th><th>Einheit</th><th className="num">Einzelpreis</th><th className="num">Rabatt %</th>
                {!settings.isSmallBusiness && <th>USt</th>}<th className="num">Netto</th><th />
              </tr>
            </thead>
            <tbody>
              {doc.items.map((it, i) => (
                <tr key={it.id}>
                  <td>
                    <textarea rows={1} aria-label={`Bezeichnung Position ${i + 1}`} value={it.description} disabled={!isDraft} onChange={(e) => updateItem(it.id, { description: e.target.value })} />
                  </td>
                  <td>
                    <input type="number" step="any" className="num" aria-label="Menge" value={it.quantity} disabled={!isDraft} onChange={(e) => updateItem(it.id, { quantity: Number(e.target.value) })} />
                  </td>
                  <td>
                    <input className="unit" aria-label="Einheit" value={it.unit} disabled={!isDraft} onChange={(e) => updateItem(it.id, { unit: e.target.value })} />
                  </td>
                  <td>
                    <MoneyInput ariaLabel="Einzelpreis" value={it.unitPrice} disabled={!isDraft} onChange={(c) => updateItem(it.id, { unitPrice: c })} />
                  </td>
                  <td>
                    <input type="number" min={0} max={100} className="num pct" aria-label="Rabatt" value={it.discountPercent} disabled={!isDraft} onChange={(e) => updateItem(it.id, { discountPercent: Number(e.target.value) })} />
                  </td>
                  {!settings.isSmallBusiness && (
                    <td>
                      <select aria-label="Steuersatz" value={it.vatRate} disabled={!isDraft} onChange={(e) => updateItem(it.id, { vatRate: Number(e.target.value) as VatRate })}>
                        {[20, 13, 10, 0].map((r) => (
                          <option key={r} value={r}>{r} %</option>
                        ))}
                      </select>
                    </td>
                  )}
                  <td className="num">{formatEuro(totals.lines[i]?.net ?? 0)}</td>
                  <td className="row-actions">
                    {isDraft && (
                      <>
                        <button className="icon" aria-label="Nach oben" disabled={i === 0} onClick={() => moveItem(i, -1)}>↑</button>
                        <button className="icon" aria-label="Nach unten" disabled={i === doc.items.length - 1} onClick={() => moveItem(i, 1)}>↓</button>
                        <button className="icon" aria-label="Position entfernen" onClick={() => update({ items: doc.items.filter((x) => x.id !== it.id) })}>×</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {isDraft && (
            <div className="item-add">
              <button onClick={() => update({ items: [...doc.items, newLineItem(settings)] })}>Leere Position</button>
              {db.articles.length > 0 && (
                <select
                  value=""
                  aria-label="Leistung aus Katalog hinzufügen"
                  onChange={(e) => {
                    const a = db.articles.find((x) => x.id === e.target.value);
                    if (a)
                      update({
                        items: [...doc.items, { ...newLineItem(settings), description: a.description ? `${a.name}\n${a.description}` : a.name, unit: a.unit, unitPrice: a.unitPrice, vatRate: settings.isSmallBusiness ? 0 : a.vatRate }],
                      });
                  }}
                >
                  <option value="">Aus Leistungskatalog …</option>
                  {db.articles.map((a) => (
                    <option key={a.id} value={a.id}>{a.name} – {formatEuro(a.unitPrice)}</option>
                  ))}
                </select>
              )}
            </div>
          )}
          <dl className="sum">
            {!totals.exemption && (
              <>
                <dt>Netto</dt><dd>{formatEuro(totals.net)}</dd>
                {totals.groups.map((g) => (
                  <span key={g.rate} className="contents"><dt>USt {g.rate} %</dt><dd>{formatEuro(g.vat)}</dd></span>
                ))}
              </>
            )}
            <dt className="grand">Gesamt</dt><dd className="grand">{formatEuro(totals.gross)}</dd>
          </dl>
        </section>

        <fieldset disabled={!isDraft} className="grid">
          <Field label="Schlusstext" wide>
            <textarea rows={2} value={doc.closingText} placeholder={isOffer ? 'z. B. Wir freuen uns auf Ihren Auftrag.' : 'z. B. Vielen Dank für die gute Zusammenarbeit.'} onChange={(e) => update({ closingText: e.target.value })} />
          </Field>
        </fieldset>

        {isDraft && (
          <section className="checks" aria-label="Prüfung der Pflichtangaben">
            <h2>Prüfung nach § 11 UStG</h2>
            {!isOffer && isSmallAmountInvoice(doc, settings) && <p className="muted">Kleinbetragsrechnung (bis 400 € brutto): vereinfachte Angaben genügen.</p>}
            {issues.length === 0 ? (
              <p className="ok">Alle Pflichtangaben vorhanden.</p>
            ) : (
              <ul>
                {issues.map((i, n) => (
                  <li key={n} className={i.level}>{i.message}</li>
                ))}
              </ul>
            )}
          </section>
        )}

        <div className="bar">
          {isDraft ? (
            <>
              <button onClick={save} disabled={!dirty}>Entwurf speichern</button>
              <button
                className="danger-text"
                onClick={async () => {
                  if (!window.confirm('Entwurf löschen?')) return;
                  setDirty(false);
                  await run(() => api.deleteDoc(doc.id), 'Entwurf gelöscht.');
                  go({ page: listPage });
                }}
              >
                Entwurf löschen
              </button>
              <button onClick={() => run(() => (dirty ? api.saveDoc(doc) : Promise.resolve()).then(() => api.exportPdf(doc.id)), 'PDF gespeichert.')}>Vorschau-PDF</button>
              <button className="primary" onClick={finalize} disabled={issues.some((i) => i.level === 'error')}>
                {isOffer ? 'Angebot finalisieren' : 'Rechnung finalisieren'}
              </button>
            </>
          ) : (
            <>
              <button className="primary" onClick={() => run(() => api.exportPdf(doc.id), 'PDF gespeichert.')}>PDF speichern</button>
              {!isOffer && (
                <>
                  <button onClick={() => exportE('ebinterface')}>ebInterface</button>
                  <button onClick={() => exportE('xrechnung')}>XRechnung</button>
                  <button onClick={() => exportE('zugferd')}>ZUGFeRD-PDF</button>
                </>
              )}
              <button
                onClick={async () => {
                  const d = (await run(() => api.duplicateDoc(doc.id), 'Kopie als Entwurf angelegt.')) as BusinessDocument | undefined;
                  if (d) go({ page: 'doc', id: d.id });
                }}
              >
                Duplizieren
              </button>
            </>
          )}
        </div>

        {isOffer && !isDraft && (
          <section className="panel">
            <h2>Angebotsstatus</h2>
            <div className="bar">
              <button onClick={() => run(() => api.setOfferStatus(doc.id, 'accepted'), 'Als angenommen markiert.')} disabled={doc.offerStatus === 'accepted'}>Angenommen</button>
              <button onClick={() => run(() => api.setOfferStatus(doc.id, 'rejected'), 'Als abgelehnt markiert.')} disabled={doc.offerStatus === 'rejected'}>Abgelehnt</button>
              <button
                className="primary"
                onClick={async () => {
                  const inv = (await run(() => api.convertOffer(doc.id), 'Rechnungsentwurf erstellt.')) as BusinessDocument | undefined;
                  if (inv) go({ page: 'doc', id: inv.id });
                }}
              >
                In Rechnung umwandeln
              </button>
            </div>
          </section>
        )}

        {doc.kind === 'invoice' && !isDraft && (
          <>
            <section className="panel">
              <h2>Zahlungen</h2>
              <p>
                Bezahlt {formatEuro(paidAmount(doc))} von {formatEuro(totals.gross)} · offen <strong>{formatEuro(openAmount(doc, settings))}</strong>
              </p>
              {doc.payments.length > 0 && (
                <ul className="plain">
                  {doc.payments.map((p) => (
                    <li key={p.id}>
                      {formatDate(p.date)} – {formatEuro(p.amount)} {p.note && `(${p.note})`}{' '}
                      <button className="link" onClick={() => window.confirm('Zahlung entfernen?') && run(() => api.removePayment(doc.id, p.id))}>entfernen</button>
                    </li>
                  ))}
                </ul>
              )}
              {doc.status === 'final' && (
                <div className="inline-form">
                  <input type="date" aria-label="Zahlungsdatum" value={payment.date} onChange={(e) => setPayment({ ...payment, date: e.target.value })} />
                  <MoneyInput ariaLabel="Betrag" value={payment.amount || Math.max(0, openAmount(doc, settings))} onChange={(c) => setPayment({ ...payment, amount: c })} />
                  <input placeholder="Notiz" aria-label="Notiz" value={payment.note} onChange={(e) => setPayment({ ...payment, note: e.target.value })} />
                  <button
                    onClick={async () => {
                      const amount = payment.amount || openAmount(doc, settings);
                      await run(() => api.addPayment(doc.id, { ...payment, amount }), 'Zahlung erfasst.');
                      setPayment({ date: todayIso(), amount: 0, note: '' });
                    }}
                  >
                    Zahlung erfassen
                  </button>
                </div>
              )}
            </section>

            <section className="panel">
              <h2>Mahnwesen</h2>
              {doc.dunning.length > 0 && (
                <ul className="plain">
                  {doc.dunning.map((d) => (
                    <li key={d.level}>
                      {['Zahlungserinnerung', '1. Mahnung', '2. Mahnung'][d.level - 1]} vom {formatDate(d.date)} – Spesen {formatEuro(d.fee)}, Zinsen {formatEuro(d.interest)}, Frist {formatDate(d.dueDate)}{' '}
                      <button className="link" onClick={() => run(() => api.exportDunningPdf(doc.id, d.level), 'PDF gespeichert.')}>PDF</button>
                    </li>
                  ))}
                </ul>
              )}
              {isOverdue(doc, settings, todayIso()) && nextDunningLevel(doc) ? (
                <div className="inline-form">
                  <label className="check"><input type="checkbox" checked={dunOpts.chargeInterest} onChange={(e) => setDunOpts({ ...dunOpts, chargeInterest: e.target.checked })} /> Verzugszinsen verrechnen</label>
                  {customer?.isBusiness && (
                    <label className="check"><input type="checkbox" checked={dunOpts.applyCollectionFee} onChange={(e) => setDunOpts({ ...dunOpts, applyCollectionFee: e.target.checked })} /> 40 € Pauschale (§ 458 UGB)</label>
                  )}
                  <button onClick={() => run(() => api.addDunning(doc.id, dunOpts), 'Mahnstufe erstellt.')}>
                    {['Zahlungserinnerung', '1. Mahnung', '2. Mahnung'][nextDunningLevel(doc)! - 1]} erstellen
                  </button>
                </div>
              ) : (
                <p className="muted">{doc.dunning.length >= 3 ? 'Alle Mahnstufen ausgeschöpft.' : 'Mahnungen sind erst nach Fälligkeit möglich.'}</p>
              )}
            </section>

            {doc.status === 'final' && (
              <section className="panel">
                <h2>Stornieren</h2>
                <p className="muted">Finalisierte Rechnungen dürfen nicht gelöscht werden. Ein Storno erzeugt eine Stornorechnung mit eigener Nummer.</p>
                <button
                  className="danger-text"
                  onClick={async () => {
                    if (!window.confirm(`Rechnung ${doc.number} stornieren?`)) return;
                    const c = (await run(() => api.cancelInvoice(doc.id), 'Stornorechnung erstellt.')) as BusinessDocument | undefined;
                    if (c) go({ page: 'doc', id: c.id });
                  }}
                >
                  Rechnung stornieren
                </button>
              </section>
            )}
          </>
        )}
        {doc.cancelledById && (
          <p className="muted">
            Storniert durch <button className="link" onClick={() => go({ page: 'doc', id: doc.cancelledById! })}>{db.documents.find((d) => d.id === doc.cancelledById)?.number}</button>
          </p>
        )}
        {source && (
          <p className="muted">
            Bezug: <button className="link" onClick={() => go({ page: 'doc', id: source.id })}>{kindLabel(source.kind, 'de')} {source.number || '(Entwurf)'}</button>
          </p>
        )}
      </div>

      <aside className="preview" aria-label="Druckvorschau">
        <PaperPreview html={html} />
      </aside>
    </div>
  );
}
