import { roundCents } from '../money';
import type { Cents } from '../types';

/**
 * Grobe Vorschau auf Einkommensteuer und SVS-Beiträge zur Bildung von Rücklagen.
 * Keine Steuerberechnung im rechtlichen Sinn: Absetzbeträge, Sonderausgaben,
 * andere Einkünfte und Vorauszahlungen bleiben unberücksichtigt.
 */

/** Einkommensteuertarif (§ 33 EStG): Obergrenzen der Stufen in Cent und Grenzsteuersatz */
const TARIFFS: Record<number, [number, number][]> = {
  2025: [[1_330_800, 0], [2_161_700, 20], [3_583_600, 30], [6_916_600, 40], [10_307_200, 48], [100_000_000, 50], [Infinity, 55]],
  2026: [[1_353_900, 0], [2_199_200, 20], [3_645_800, 30], [7_036_500, 40], [10_485_900, 48], [100_000_000, 50], [Infinity, 55]],
};

export function tariffYear(year: number): number {
  const years = Object.keys(TARIFFS).map(Number).sort();
  return years.filter((y) => y <= year).pop() ?? years[0];
}

export function incomeTax(taxable: Cents, year: number): Cents {
  let tax = 0;
  let lower = 0;
  for (const [upper, rate] of TARIFFS[tariffYear(year)]) {
    if (taxable <= lower) break;
    tax += ((Math.min(taxable, upper) - lower) * rate) / 100;
    lower = upper;
  }
  return roundCents(tax);
}

/** SVS-Werte nach GSVG (Stand 2025; jährlich anpassen) */
export const SVS = {
  year: 2025,
  health: 6.8,
  pension: 18.5,
  selfEmployedProvision: 1.53,
  accidentPerMonth: 1_207,
  /** Mindestbeitragsgrundlage KV/PV pro Jahr */
  minBase: 661_320,
  /** Höchstbeitragsgrundlage pro Jahr */
  maxBase: 9_030_000,
};

export interface SvsEstimate {
  base: Cents;
  health: Cents;
  pension: Cents;
  provision: Cents;
  accident: Cents;
  total: Cents;
}

/**
 * Beitragsgrundlage = Gewinn + im Jahr vorgeschriebene/bezahlte SVS-Beiträge (Hinzurechnung).
 */
export function svsEstimate(profit: Cents, svsPaid: Cents): SvsEstimate {
  const raw = Math.max(0, profit + svsPaid);
  const base = Math.min(Math.max(raw, SVS.minBase), SVS.maxBase);
  const health = roundCents((base * SVS.health) / 100);
  const pension = roundCents((base * SVS.pension) / 100);
  const provision = roundCents((base * SVS.selfEmployedProvision) / 100);
  const accident = SVS.accidentPerMonth * 12;
  return { base, health, pension, provision, accident, total: health + pension + provision + accident };
}

export interface TaxEstimate {
  svs: SvsEstimate;
  /** Differenz zwischen geschätzten und bereits bezahlten SVS-Beiträgen */
  svsDifference: Cents;
  taxableIncome: Cents;
  incomeTax: Cents;
  tariffYear: number;
  /** Empfohlene Rücklage: ESt + SVS-Nachzahlung */
  reserve: Cents;
}

export function estimateTaxes(taxableProfit: Cents, svsPaid: Cents, year: number, svsInsured = true): TaxEstimate {
  const svs = svsInsured ? svsEstimate(taxableProfit, svsPaid) : { base: 0, health: 0, pension: 0, provision: 0, accident: 0, total: 0 };
  const svsDifference = svsInsured ? svs.total - svsPaid : 0;
  // Die SVS-Nachzahlung ist im Jahr der Zahlung absetzbar; für die Schätzung wird sie bereits abgezogen.
  const taxableIncome = Math.max(0, taxableProfit - Math.max(0, svsDifference));
  const tax = incomeTax(taxableIncome, year);
  return { svs, svsDifference, taxableIncome, incomeTax: tax, tariffYear: tariffYear(year), reserve: tax + Math.max(0, svsDifference) };
}
