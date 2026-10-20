import { yearOf } from '../dates';
import { roundCents } from '../money';
import type { Asset, Cents } from '../types';

/** Grenze für geringwertige Wirtschaftsgüter (§ 13 EStG, ab 2023): 1.000 € */
export const LOW_VALUE_LIMIT: Cents = 100_000;

export interface AfaYear {
  year: number;
  /** Abschreibung des Jahres (bereits mit betrieblichem Anteil) */
  afa: Cents;
  /** Restbuchwert zum Jahresende */
  bookValue: Cents;
  /** Restbuchwert bei Ausscheiden (als Aufwand) */
  disposalLoss: Cents;
}

/**
 * Lineare AfA nach § 7 EStG mit Halbjahresregel: Inbetriebnahme im zweiten
 * Halbjahr → halbe Jahres-AfA; bei Ausscheiden im ersten Halbjahr ebenfalls
 * nur die halbe AfA, der Restbuchwert wird im Jahr des Ausscheidens abgesetzt.
 */
export function afaSchedule(asset: Asset): AfaYear[] {
  const share = Math.min(Math.max(asset.businessUsePercent, 0), 100) / 100;
  const base = roundCents(asset.cost * share);
  const startYear = yearOf(asset.inServiceDate || asset.acquisitionDate);
  if (asset.lowValue) return [{ year: startYear, afa: base, bookValue: 0, disposalLoss: 0 }];

  const life = Math.max(1, asset.usefulLifeYears);
  const annual = roundCents(base / life);
  const halfStart = Number((asset.inServiceDate || asset.acquisitionDate).slice(5, 7)) > 6;
  const disposalYear = asset.disposalDate ? yearOf(asset.disposalDate) : Infinity;
  const halfEnd = asset.disposalDate ? Number(asset.disposalDate.slice(5, 7)) <= 6 : false;

  const out: AfaYear[] = [];
  let book = base;
  for (let year = startYear; book > 0 && year <= disposalYear; year++) {
    let afa = annual;
    if (year === startYear && year === disposalYear) {
      // Nutzung im selben Jahr begonnen und beendet: halbe AfA bei höchstens sechs Monaten
      const months = Number(asset.disposalDate.slice(5, 7)) - Number((asset.inServiceDate || asset.acquisitionDate).slice(5, 7)) + 1;
      if (months <= 6) afa = roundCents(annual / 2);
    } else if (year === startYear && halfStart) afa = roundCents(annual / 2);
    else if (year === disposalYear && halfEnd) afa = roundCents(annual / 2);
    afa = Math.min(afa, book);
    book -= afa;
    let disposalLoss = 0;
    if (year === disposalYear) {
      disposalLoss = book;
      book = 0;
    }
    out.push({ year, afa, bookValue: book, disposalLoss });
  }
  return out;
}

export function afaForYear(assets: Asset[], year: number): { asset: Asset; row: AfaYear }[] {
  return assets
    .map((asset) => ({ asset, row: afaSchedule(asset).find((r) => r.year === year) }))
    .filter((x): x is { asset: Asset; row: AfaYear } => !!x.row);
}

/** Gängige Nutzungsdauern als Vorschlag */
export const USEFUL_LIFE_HINTS: { label: string; years: number }[] = [
  { label: 'Computer, Laptop, Tablet', years: 3 },
  { label: 'Smartphone', years: 2 },
  { label: 'Software', years: 3 },
  { label: 'Büromöbel', years: 10 },
  { label: 'PKW (gesetzlich mind. 8 Jahre)', years: 8 },
  { label: 'Maschinen, Werkzeug', years: 5 },
];
