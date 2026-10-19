import { yearOf } from './dates';
import type { DocumentKind, NumberCounters } from './types';

/**
 * Nummernmuster mit Platzhaltern:
 *   {JJJJ} / {YYYY}  vierstelliges Jahr
 *   {JJ} / {YY}      zweistelliges Jahr
 *   {N...}           fortlaufende Nummer, Anzahl der N = Mindeststellen (z. B. {NNNN} → 0001)
 *
 * Enthält das Muster ein Jahr, beginnt der Zähler jedes Jahr neu. Die Kombination
 * aus Jahr und Laufnummer bleibt damit eindeutig und fortlaufend (§ 11 Abs 1 Z 3 lit c UStG).
 */
const YEAR_RE = /\{(JJJJ|YYYY|JJ|YY)\}/;
const SEQ_RE = /\{(N+)\}/;

export function validatePattern(pattern: string): string | null {
  if (!SEQ_RE.test(pattern)) return 'Das Muster muss eine Laufnummer enthalten, z. B. {NNNN}.';
  if ((pattern.match(/\{N+\}/g) ?? []).length > 1) return 'Das Muster darf nur eine Laufnummer enthalten.';
  const stripped = pattern.replace(/\{(JJJJ|YYYY|JJ|YY|N+)\}/g, '');
  if (/[{}]/.test(stripped)) return 'Unbekannter Platzhalter im Muster.';
  return null;
}

export function counterKey(kind: DocumentKind, pattern: string, issueDate: string): string {
  return YEAR_RE.test(pattern) ? `${kind}:${yearOf(issueDate)}` : kind;
}

export function formatNumber(pattern: string, seq: number, issueDate: string): string {
  const year = String(yearOf(issueDate));
  return pattern
    .replace(/\{(JJJJ|YYYY)\}/g, year)
    .replace(/\{(JJ|YY)\}/g, year.slice(2))
    .replace(SEQ_RE, (_m, ns: string) => String(seq).padStart(ns.length, '0'));
}

/** Liefert die nächste Nummer und den aktualisierten Zählerstand (ohne Mutation). */
export function nextNumber(
  counters: NumberCounters,
  kind: DocumentKind,
  pattern: string,
  issueDate: string,
): { number: string; counters: NumberCounters } {
  const err = validatePattern(pattern);
  if (err) throw new Error(err);
  const key = counterKey(kind, pattern, issueDate);
  const seq = (counters[key] ?? 0) + 1;
  return { number: formatNumber(pattern, seq, issueDate), counters: { ...counters, [key]: seq } };
}
