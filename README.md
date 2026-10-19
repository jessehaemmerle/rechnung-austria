# Rechnung Austria

Desktop-App (Electron) für Angebote und Rechnungen von österreichischen Ein-Personen-Unternehmen.
Alle Daten bleiben lokal auf Ihrem Rechner.

## Funktionen

- **Angebote → Rechnungen**: Angebot erstellen, als angenommen/abgelehnt markieren, mit einem Klick in eine Rechnung umwandeln
- **Steuerfälle**
  - Kleinunternehmer (§ 6 Abs 1 Z 27 UStG) mit Pflichthinweis und Überwachung der Umsatzgrenze (55.000 €, 10 %-Toleranz bis 60.500 €, Vorjahresprüfung)
  - Regelbesteuerung mit 20 / 13 / 10 / 0 % (Steuer je Satz auf die Nettosumme)
  - EU-B2B-Leistungen mit Reverse Charge sowie innergemeinschaftliche Lieferungen
- **Prüfung der Rechnungsmerkmale nach § 11 UStG** vor dem Finalisieren, inkl. Kleinbetragsrechnung bis 400 € brutto und Kunden-UID ab 10.000 €
- **Lückenlose Nummernkreise** mit frei konfigurierbarem Muster (`RE-{JJJJ}-{NNNN}` …); die Nummer wird erst beim Finalisieren vergeben
- **Unveränderbarkeit**: finalisierte Dokumente werden mit Firmen- und Kundendaten eingefroren; Korrekturen nur über eine Stornorechnung mit eigener Nummer
- **Zahlungen und Mahnwesen**: Teilzahlungen, Überfälligkeit, drei Mahnstufen mit Spesen, taggenauen Verzugszinsen (§ 456 UGB: Basiszinssatz + 9,2 %; § 1000 ABGB: 4 %) und optionaler Pauschale von 40 € (§ 458 UGB)
- **Export**: PDF, ebInterface 6.1 (E-Rechnung an den Bund), XRechnung (UBL, EN 16931), ZUGFeRD/Factur-X (PDF mit eingebettetem XML)
- **Auswertungen**: Umsatz je Monat, Aufteilung nach Steuersätzen und Reverse Charge, CSV-Export für die Steuerberatung
- Deutsch und Englisch je Kunde, Leistungskatalog, Logo, tägliche automatische Backups, Sicherung exportieren und wiederherstellen

## Installation und Start

Voraussetzung: Node.js 22.

```bash
npm install
npm start          # baut und startet die App
npm run dev        # Entwicklung mit Hot Reload
npm run dist       # Installer für das aktuelle Betriebssystem (release/)
```

Daten liegen in `rechnung-daten.json` im Benutzerdatenordner der App (Einstellungen → „Datenordner öffnen“).
Mit der Umgebungsvariable `RECHNUNG_DATA_DIR` kann ein anderer Ordner verwendet werden, z. B. für die portable Nutzung.

## Tests

```bash
npm test                    # Steuerlogik, Nummernkreise, Mahnwesen, E-Rechnung
npm run typecheck
./scripts/fetch-schemas.sh  # einmalig: offizielle XSDs laden, dann prüft npm test
                            # alle E-Rechnungen auch gegen ebInterface 6.1, UBL 2.1 und CII D16B
```

Die erzeugten XRechnung- und Factur-X-Dateien wurden zusätzlich gegen die EN-16931-Schematron-Regeln (Version 1.3.13) geprüft:
Regelbesteuerung, Kleinunternehmer, Reverse Charge, innergemeinschaftliche Lieferung und Storno.

## Aufbau

```
src/core/       Fachlogik ohne UI (Steuer, § 11-Prüfung, Nummern, Mahnwesen, Druckvorlage, E-Rechnung)
src/main/       Electron-Hauptprozess: Speicherung, PDF-Erzeugung, Dateidialoge
src/preload/    Schnittstelle zwischen Oberfläche und Hauptprozess
src/renderer/   React-Oberfläche
tests/          Vitest-Tests
```

## Grenzen und Hinweise

- **Keine Steuerberatung.** Die Regeln sind nach bestem Wissen umgesetzt (Stand 2026); Grenzfälle bitte mit der Steuerberatung klären.
- Bei der Kleinunternehmergrenze werden alle Rechnungen gezählt. Umsätze, die gesetzlich außer Ansatz bleiben (z. B. Hilfsgeschäfte), werden nicht automatisch herausgerechnet.
- Der Basiszinssatz der OeNB muss in den Einstellungen aktuell gehalten werden.
- Die UID-Prüfung prüft nur das Format; die Stufe-2-Abfrage über FinanzOnline/MIAS bleibt Ihre Aufgabe.
- ZUGFeRD-PDFs enthalten das Factur-X-XML und die XMP-Metadaten. Chromium erzeugt aber kein zertifiziertes PDF/A-3. Wenn ein Empfänger streng auf PDF/A-3 prüft, schicken Sie zusätzlich die XRechnung oder ebInterface.
- E-Rechnungen von Kleinunternehmern ohne UID brauchen eine Steuernummer in den Einstellungen.
- Aufbewahrungspflicht: 7 Jahre (§ 132 BAO). Exportieren Sie Sicherungen regelmäßig auf ein externes Medium.

## Lizenz

GPL-3.0, siehe [LICENSE](LICENSE).
