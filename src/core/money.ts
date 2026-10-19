import type { Cents, Language } from './types';

/** Kaufmännische Rundung auf ganze Cent (halbe Cent werden von 0 weg gerundet). */
export function roundCents(value: number): Cents {
  const sign = value < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(value) + Number.EPSILON * 10);
}

export function toCents(euros: number): Cents {
  return roundCents(euros * 100);
}

/** "12,50" oder "12.50" oder "1.234,50" → 1250 */
export function parseEuro(input: string): Cents {
  let s = input.trim().replace(/[€\s]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error(`Ungültiger Betrag: ${input}`);
  return toCents(n);
}

const euroFormatters: Record<Language, Intl.NumberFormat> = {
  de: new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR' }),
  en: new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR' }),
};

export function formatEuro(cents: Cents, lang: Language = 'de'): string {
  const fmt = euroFormatters[lang];
  return fmt.format(cents / 100);
}

/** Betrag im XML-Format "1234.50" */
export function centsToDecimal(cents: Cents): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
