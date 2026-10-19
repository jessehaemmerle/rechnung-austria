/** Datumswerte werden als ISO-Datum "YYYY-MM-DD" gespeichert (ohne Zeitzone). */
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export function yearOf(iso: string): number {
  return Number(iso.slice(0, 4));
}

export function formatDate(iso: string, lang: 'de' | 'en' = 'de'): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return lang === 'de' ? `${d}.${m}.${y}` : `${d}/${m}/${y}`;
}
