import type { TextItem } from './dataset.js';
import type { EvalDetector } from './detectors.js';
import { splitOf } from './split.js';
import {
  auroc,
  conformalThreshold,
  fprBySubgroup,
  rate,
  type Scored,
  type SubgroupRate,
} from './metrics.js';

export interface DetectorReport {
  detector: string;
  description: string;
  dataset: string;
  alpha: number;
  n: number;
  assessed: number;
  notAssessedShare: number;
  notAssessedReasons: Record<string, number>;
  auroc: number;
  threshold: number;
  /** Detection rate (TPR) on AI items at the conformal threshold. */
  detectionRate: number;
  /** FPR on the same human items used for calibration (in-sample: optimistic, toy only). */
  falsePositiveRate: number;
  fprBySubgroup: SubgroupRate[];
  detectionBySubgroup: { subgroup: string; n: number; detectionRate: number }[];
  warnings: string[];
}

/**
 * Runs one detector over a dataset.
 * - Calibrated detectors (conformal scores): flag when score >= 1 - alpha, measured on the
 *   held-out test split when the dataset has groups.
 * - Uncalibrated detectors: in-sample conformal threshold (toy harness check only).
 */
export function evaluate(
  detector: EvalDetector,
  dataset: string,
  all: readonly TextItem[],
  alpha: number,
): DetectorReport {
  const hasSplits = all.some((i) => i.group !== undefined);
  const items =
    detector.calibrated && hasSplits ? all.filter((i) => splitOf(i.group ?? i.id) === 'test') : all;
  const scored: Scored[] = [];
  const notAssessedReasons: Record<string, number> = {};
  for (const item of items) {
    const r = detector.run(item);
    if (r.status === 'assessed')
      scored.push({ truth: item.truth, score: r.signal.score, subgroup: item.subgroup });
    else notAssessedReasons[r.reason] = (notAssessedReasons[r.reason] ?? 0) + 1;
  }
  const human = scored.filter((s) => s.truth === 'human');
  const ai = scored.filter((s) => s.truth === 'ai');
  const warnings: string[] = [];
  let threshold: number;
  if (detector.calibrated) {
    // flagged() uses ">", so step just below 1 - alpha to mean "score >= 1 - alpha".
    threshold = 1 - alpha - 1e-9;
    if (hasSplits)
      warnings.push('Measured on the held-out test split (not used for training or calibration).');
    else warnings.push('Dataset has no held-out split; numbers are indicative only.');
  } else {
    threshold = conformalThreshold(
      human.map((s) => s.score),
      alpha,
    );
    warnings.push('In-sample calibration (harness check). Do not quote these numbers.');
    if (!Number.isFinite(threshold))
      warnings.push(
        `Only ${human.length} human items: too few to guarantee FPR <= ${alpha}. Nothing is flagged.`,
      );
  }
  return {
    detector: detector.id,
    description: detector.description,
    dataset,
    alpha,
    n: items.length,
    assessed: scored.length,
    notAssessedShare: items.length === 0 ? 0 : (items.length - scored.length) / items.length,
    notAssessedReasons,
    auroc: auroc(scored),
    threshold,
    detectionRate: rate(ai, threshold),
    falsePositiveRate: rate(human, threshold),
    fprBySubgroup: fprBySubgroup(scored, threshold),
    detectionBySubgroup: detectionBySubgroup(scored, threshold),
    warnings,
  };
}

function detectionBySubgroup(items: readonly Scored[], threshold: number) {
  const groups = new Map<string, Scored[]>();
  for (const i of items) {
    if (i.truth !== 'ai') continue;
    groups.set(i.subgroup, [...(groups.get(i.subgroup) ?? []), i]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([subgroup, g]) => ({ subgroup, n: g.length, detectionRate: rate(g, threshold) }));
}

const fmt = (x: number) => (Number.isNaN(x) ? 'n/a' : Number.isFinite(x) ? x.toFixed(3) : 'inf');
const pct = (x: number) => (Number.isNaN(x) ? 'n/a' : `${(x * 100).toFixed(1)}%`);

export function toMarkdown(reports: readonly DetectorReport[]): string {
  const lines = [`## Text detectors on \`${reports[0]?.dataset ?? 'unknown'}\``, ''];
  for (const r of reports) {
    lines.push(
      `### ${r.detector}`,
      '',
      r.description,
      '',
      ...r.warnings.map((w) => `> **Warning:** ${w}`),
      '',
      '| Metric | Value |',
      '|---|---|',
      `| Items | ${r.n} (assessed ${r.assessed}) |`,
      `| Not assessed | ${pct(r.notAssessedShare)} ${JSON.stringify(r.notAssessedReasons)} |`,
      `| AUROC | ${fmt(r.auroc)} |`,
      `| Target FPR (alpha) | ${pct(r.alpha)} |`,
      `| Conformal threshold | ${fmt(r.threshold)} |`,
      `| Detection rate at threshold | ${pct(r.detectionRate)} |`,
      `| False-positive rate at threshold | ${pct(r.falsePositiveRate)} |`,
      '',
      '**False positives by subgroup (human items only)**',
      '',
      '| Subgroup | n | FPR |',
      '|---|---|---|',
      ...r.fprBySubgroup.map((g) => `| ${g.subgroup} | ${g.n} | ${pct(g.falsePositiveRate)} |`),
      '',
      '**Detection rate by subgroup (AI items only)**',
      '',
      '| Subgroup | n | Detected |',
      '|---|---|---|',
      ...r.detectionBySubgroup.map((g) => `| ${g.subgroup} | ${g.n} | ${pct(g.detectionRate)} |`),
      '',
    );
  }
  return lines.join('\n');
}
