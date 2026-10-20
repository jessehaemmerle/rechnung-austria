import { yearOf } from '../dates';
import { roundCents } from '../money';
import type { Cents, Trip } from '../types';

/** Amtliches Kilometergeld für PKW ab 1.1.2025: 0,50 €/km */
export const DEFAULT_KM_RATE: Cents = 50;
/** Kilometergeld steht für höchstens 30.000 km pro Kalenderjahr zu */
export const MAX_KM_PER_YEAR = 30_000;

export function kmAllowanceForYear(trips: Trip[], year: number): { km: number; amount: Cents; cappedKm: number } {
  let remaining = MAX_KM_PER_YEAR;
  let km = 0;
  let amount = 0;
  let cappedKm = 0;
  for (const t of [...trips].filter((t) => yearOf(t.date) === year).sort((a, b) => a.date.localeCompare(b.date))) {
    const counted = Math.min(t.km, remaining);
    remaining -= counted;
    cappedKm += t.km - counted;
    km += counted;
    amount += roundCents(counted * t.rate);
  }
  return { km, amount, cappedKm };
}
