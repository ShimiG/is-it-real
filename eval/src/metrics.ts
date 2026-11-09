/**
 * Evaluation metrics. Ground-truth labels are 'ai' | 'human' (dataset truth, NOT a product outcome).
 *
 * Thresholds follow split-conformal prediction (ADR-0006): given n human calibration scores and a
 * target false-positive rate alpha, the threshold q is the ceil((n+1)(1-alpha))-th smallest human
 * score, and an item is flagged when score > q. If n is too small for the requested alpha, q is
 * +Infinity: we refuse to flag rather than pretend to a guarantee we cannot give.
 */

export type Truth = 'ai' | 'human';

export interface Scored {
  truth: Truth;
  score: number;
  subgroup: string;
}

/** Area under the ROC curve via the Mann-Whitney U statistic (ties count half). NaN if a class is empty. */
export function auroc(items: readonly Scored[]): number {
  const pos = items.filter((i) => i.truth === 'ai').map((i) => i.score);
  const neg = items.filter((i) => i.truth === 'human').map((i) => i.score);
  if (pos.length === 0 || neg.length === 0) return Number.NaN;
  const all = [...pos.map((s) => ({ s, p: true })), ...neg.map((s) => ({ s, p: false }))].sort(
    (a, b) => a.s - b.s,
  );
  // Average ranks for ties.
  let rankSumPos = 0;
  for (let i = 0; i < all.length;) {
    let j = i;
    while (j + 1 < all.length && all[j + 1]!.s === all[i]!.s) j++;
    const avgRank = (i + j + 2) / 2; // ranks are 1-based
    for (let k = i; k <= j; k++) if (all[k]!.p) rankSumPos += avgRank;
    i = j + 1;
  }
  const u = rankSumPos - (pos.length * (pos.length + 1)) / 2;
  return u / (pos.length * neg.length);
}

/** Split-conformal threshold on human scores for target FPR alpha. */
export function conformalThreshold(humanScores: readonly number[], alpha: number): number {
  if (!(alpha > 0 && alpha < 1)) throw new RangeError('alpha must be in (0, 1)');
  const n = humanScores.length;
  const k = Math.ceil((n + 1) * (1 - alpha));
  if (k > n) return Number.POSITIVE_INFINITY;
  return [...humanScores].sort((a, b) => a - b)[k - 1]!;
}

export const flagged = (score: number, threshold: number): boolean => score > threshold;

export function rate(items: readonly Scored[], threshold: number): number {
  if (items.length === 0) return Number.NaN;
  return items.filter((i) => flagged(i.score, threshold)).length / items.length;
}

export interface SubgroupRate {
  subgroup: string;
  n: number;
  falsePositiveRate: number;
}

/** False-positive rate per subgroup of human items: the bias table (P5). */
export function fprBySubgroup(items: readonly Scored[], threshold: number): SubgroupRate[] {
  const groups = new Map<string, Scored[]>();
  for (const i of items) {
    if (i.truth !== 'human') continue;
    const g = groups.get(i.subgroup) ?? [];
    g.push(i);
    groups.set(i.subgroup, g);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([subgroup, g]) => ({ subgroup, n: g.length, falsePositiveRate: rate(g, threshold) }));
}
