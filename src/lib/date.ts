// Pure local-date helpers shared by streak and skill-score logic. Kept dependency-free
// and side-effect-free (except reading the clock in `todayKey`) so they are trivially
// testable and reusable (SRP/DIP — callers depend on these abstractions, not on Date).

/** Today as a local date key `YYYY-M-D` (not zero-padded; stable within a calendar day). */
export function todayKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** Parse a `YYYY-M-D` key back into a local Date at midnight. */
function parseKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** Whole calendar days from `fromKey` to `toKey` (positive when `toKey` is later). */
export function daysBetween(fromKey: string, toKey: string): number {
  const a = parseKey(fromKey).getTime();
  const b = parseKey(toKey).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** Clamp `n` into the inclusive `[lo, hi]` range. */
export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
