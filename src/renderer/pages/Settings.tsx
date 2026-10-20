import { useEffect, useState } from 'react';
import { isValidVatIdFormat } from '../../core/compliance';
import { formatNumber, validatePattern } from '../../core/numbering';
import { todayIso } from '../../core/dates';
import type { CompanySettings } from '../../core/types';
import { api } from '../api';
import type { PageProps } from '../App';
import { Field, MoneyInput } from '../components/fields';

export function Settings({ db, reload, notify }: PageProps) {
  const [s, setS] = useState<CompanySettings>(db.settings);
  const [info, setInfo] = useState<{ dataFile: string; version: string } | null>(null);
  useEffect(() => {
    api.appInfo().then(setInfo).catch(() => undefined);
  }, []);
  const set = (p: Partial<CompanySettings>) => setS({ ...s, ...p });
  const setAddr = (p: Partial<CompanySettings['address']>) => setS({ ...s, address: { ...s.address, ...p } });
  const hasFinal = db.documents.some((d) => d.status !== 'draft');

  const save = async () => {
    try {
      await api.saveSettings(s);
      await reload();
      notify('Einstellungen gespeichert.');
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  };

  const pattern = (label: string, key: 'invoiceNumberPattern' | 'offerNumberPattern' | 'creditNoteNumberPattern') => {
    const err = validatePattern(s[key]);
    return (
      <Field label={label} hint={err ?? `Nächste z. B.: ${formatNumber(s[key], 1, todayIso())}`}>
        <input value={s[key]} onChange={(e) => set({ [key]: e.target.value })} aria-invalid={!!err} />
      </Field>
    );
  };

  const onLogo = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 500_000) return notify('Logo ist größer als 500 KB.', 'error');
    const reader = new FileReader();
    reader.onload = () => set({ logo: String(reader.result) });
    reader.readAsDataURL(file);
  };

  return (
    <div className="page">
      <header className="page-head">
        <h1>Einstellungen</h1>
        <button className="primary" onClick={save}>Einstellungen speichern</button>
      </header>

      <section className="panel">
        <h2>Ihr Unternehmen</h2>
        <div className="grid">
          <Field label="Firmenwortlaut / Name" wide><input value={s.name} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label="Inhaber:in"><input value={s.owner} onChange={(e) => set({ owner: e.target.value })} /></Field>
          <Field label="Straße und Hausnummer" wide><input value={s.address.street} onChange={(e) => setAddr({ street: e.target.value })} /></Field>
          <Field label="PLZ"><input value={s.address.zip} onChange={(e) => setAddr({ zip: e.target.value })} /></Field>
          <Field label="Ort"><input value={s.address.city} onChange={(e) => setAddr({ city: e.target.value })} /></Field>
          <Field label="E-Mail"><input type="email" value={s.email} onChange={(e) => set({ email: e.target.value })} /></Field>
          <Field label="Telefon"><input value={s.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
          <Field label="Website"><input value={s.website} onChange={(e) => set({ website: e.target.value })} /></Field>
          <Field label="Logo" hint="PNG, JPG oder SVG, max. 500 KB">
            <input type="file" accept="image/png,image/jpeg,image/svg+xml" onChange={(e) => onLogo(e.target.files?.[0])} />
          </Field>
          {s.logo && (
            <div className="logo-preview">
              <img src={s.logo} alt="Logo" />
              <button className="link" onClick={() => set({ logo: '' })}>Logo entfernen</button>
            </div>
          )}
        </div>
      </section>

      <section className="panel">
        <h2>Steuer</h2>
        <div className="grid">
          <Field label="Umsatzsteuer" wide hint={hasFinal ? 'Bereits finalisierte Rechnungen behalten ihre Besteuerung.' : undefined}>
            <select value={s.isSmallBusiness ? 'ku' : 'regel'} onChange={(e) => set({ isSmallBusiness: e.target.value === 'ku' })}>
              <option value="ku">Kleinunternehmer – umsatzsteuerbefreit (§ 6 Abs 1 Z 27 UStG)</option>
              <option value="regel">Regelbesteuerung – 20 / 13 / 10 % USt</option>
            </select>
          </Field>
          <Field label="UID-Nummer" hint={s.vatId && !isValidVatIdFormat(s.vatId) ? 'Format ungültig (ATU + 8 Ziffern)' : s.isSmallBusiness ? 'Optional; für EU-Geschäfte erforderlich' : 'Pflicht ab 400 € Rechnungsbetrag'}>
            <input value={s.vatId} onChange={(e) => set({ vatId: e.target.value.replace(/\s/g, '').toUpperCase() })} />
          </Field>
          <Field label="Steuernummer"><input value={s.taxNumber} onChange={(e) => set({ taxNumber: e.target.value })} /></Field>
          <Field label="Firmenbuch" hint="z. B. FN 123456a, HG Wien – falls eingetragen"><input value={s.registerInfo} onChange={(e) => set({ registerInfo: e.target.value })} /></Field>
        </div>
      </section>

      <section className="panel">
        <h2>Bankverbindung</h2>
        <div className="grid">
          <Field label="IBAN" wide><input value={s.iban} onChange={(e) => set({ iban: e.target.value.toUpperCase() })} /></Field>
          <Field label="BIC"><input value={s.bic} onChange={(e) => set({ bic: e.target.value.toUpperCase() })} /></Field>
          <Field label="Bank"><input value={s.bankName} onChange={(e) => set({ bankName: e.target.value })} /></Field>
        </div>
      </section>

      <section className="panel">
        <h2>Nummern und Fristen</h2>
        <p className="muted">Platzhalter: {'{JJJJ}'} Jahr, {'{JJ}'} Jahr zweistellig, {'{NNNN}'} Laufnummer mit Mindeststellen. Mit Jahr im Muster beginnt die Zählung jährlich neu.</p>
        <div className="grid">
          {pattern('Rechnungsnummer', 'invoiceNumberPattern')}
          {pattern('Angebotsnummer', 'offerNumberPattern')}
          {pattern('Stornonummer', 'creditNoteNumberPattern')}
          <Field label="Zahlungsziel (Tage)"><input type="number" min={0} value={s.defaultPaymentTermDays} onChange={(e) => set({ defaultPaymentTermDays: Number(e.target.value) })} /></Field>
          <Field label="Angebot gültig (Tage)"><input type="number" min={0} value={s.defaultOfferValidityDays} onChange={(e) => set({ defaultOfferValidityDays: Number(e.target.value) })} /></Field>
          <Field label="Standardsprache">
            <select value={s.defaultLanguage} onChange={(e) => set({ defaultLanguage: e.target.value as 'de' | 'en' })}>
              <option value="de">Deutsch</option><option value="en">Englisch</option>
            </select>
          </Field>
        </div>
      </section>

      <section className="panel">
        <h2>Buchhaltung</h2>
        <div className="grid">
          <Field label="UVA-Zeitraum" hint="Monatlich ab 100.000 € Vorjahresumsatz">
            <select value={s.vatPeriod} onChange={(e) => set({ vatPeriod: e.target.value as CompanySettings['vatPeriod'] })}>
              <option value="quarterly">Vierteljährlich</option><option value="monthly">Monatlich</option>
            </select>
          </Field>
          <Field label="Besteuerung" hint="Ist: nach Zahlungseingang (Freiberufler, Umsatz bis 110.000 €)">
            <select value={s.taxationBasis} onChange={(e) => set({ taxationBasis: e.target.value as CompanySettings['taxationBasis'] })}>
              <option value="ist">Ist-Besteuerung</option><option value="soll">Soll-Besteuerung</option>
            </select>
          </Field>
          <Field label="Kilometergeld (€/km)"><MoneyInput value={s.kmRate} onChange={(c) => set({ kmRate: c })} /></Field>
          <label className="check field"><input type="checkbox" checked={s.svsInsured} onChange={(e) => set({ svsInsured: e.target.checked })} /> Pflichtversichert bei der SVS (GSVG)</label>
        </div>
        <details>
          <summary>Sachkonten für BMD/DATEV (EKR)</summary>
          <div className="grid">
            {([['bank', 'Bank'], ['cash', 'Kassa'], ['revenue20', 'Erlöse 20 %'], ['revenue13', 'Erlöse 13 %'], ['revenue10', 'Erlöse 10 %'], ['revenueExempt', 'Erlöse steuerfrei/KU'], ['revenueReverseCharge', 'Erlöse EU Reverse Charge'], ['revenueIgDelivery', 'Erlöse ig. Lieferung']] as const).map(([k, label]) => (
              <Field key={k} label={label}><input value={s.accounts[k]} onChange={(e) => set({ accounts: { ...s.accounts, [k]: e.target.value.replace(/\D/g, '') } })} /></Field>
            ))}
          </div>
        </details>
      </section>

      <section className="panel">
        <h2>Mahnwesen</h2>
        <div className="grid">
          <Field label="Basiszinssatz OeNB (%)" hint="Verzugszinsen B2B = Basiszinssatz + 9,2 %; Privat 4 %">
            <input type="number" step="0.01" value={s.baseInterestRate} onChange={(e) => set({ baseInterestRate: Number(e.target.value) })} />
          </Field>
          {(['Zahlungserinnerung', '1. Mahnung', '2. Mahnung'] as const).map((label, i) => (
            <div key={label} className="pair">
              <Field label={`${label}: Spesen`}>
                <MoneyInput value={s.dunningFees[i]} onChange={(c) => { const f = [...s.dunningFees] as CompanySettings['dunningFees']; f[i] = c; set({ dunningFees: f }); }} />
              </Field>
              <Field label="Frist (Tage)">
                <input type="number" min={1} value={s.dunningDays[i]} onChange={(e) => { const d = [...s.dunningDays] as CompanySettings['dunningDays']; d[i] = Number(e.target.value); set({ dunningDays: d }); }} />
              </Field>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>Fußzeile</h2>
        <Field label="Zusätzlicher Text auf jedem Dokument" wide>
          <textarea rows={2} value={s.footerNote} onChange={(e) => set({ footerNote: e.target.value })} />
        </Field>
      </section>

      <section className="panel">
        <h2>Daten und Sicherung</h2>
        <p className="muted">
          Rechnungen und Belege sind 7 Jahre aufzubewahren (§ 132 BAO). Die App legt täglich automatisch ein Backup an. Die Sicherungsdatei enthält alle Daten, aber nicht die Belegdateien –
          sichern Sie dafür regelmäßig den gesamten Datenordner (inkl. Ordner „belege“) auf ein externes Medium.
        </p>
        {info && <p className="muted">Datendatei: {info.dataFile} · Version {info.version}</p>}
        <div className="bar">
          <button onClick={() => api.exportBackup().then((p) => p && notify('Sicherung gespeichert.'))}>Sicherung exportieren</button>
          <button onClick={() => api.importBackup().then(async (ok) => { if (ok) { await reload(); notify('Sicherung wiederhergestellt.'); } }).catch((e) => notify(e.message, 'error'))}>Sicherung wiederherstellen</button>
          <button onClick={() => api.showDataFolder()}>Datenordner öffnen</button>
        </div>
      </section>
    </div>
  );
}
