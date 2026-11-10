/**
 * Conformal scoring (ADR-0006). A detector's raw score is turned into
 *   score = 1 - p,  p = (1 + #{human calibration scores >= raw}) / (n + 1)
 * so that `score >= 1 - alpha` flags at most an alpha share of human content like the
 * calibration set. With n human items the score can never exceed n / (n + 1): with too little
 * calibration data a detector cannot reach the 0.99 "Likely AI" bar, by construction.
 *
 * `calibration` must be sorted ascending.
 */
export function conformalScore(raw: number, calibration: readonly number[]): number {
  const n = calibration.length;
  if (n === 0) return 0;
  // Binary search for the first calibration value >= raw.
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (calibration[mid]! < raw) lo = mid + 1;
    else hi = mid;
  }
  const atLeast = n - lo;
  return 1 - (1 + atLeast) / (n + 1);
}
