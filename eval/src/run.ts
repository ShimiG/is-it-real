import type { TextItem } from './dataset.js';
import type { EvalDetector } from './detectors.js';
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
  warnings: string[];
}

/**
 * Runs one detector over a dataset. M0 calibrates and measures on the same items (in-sample),
 * which is only acceptable for the toy set; M2 introduces a held-out calibration split.
 */
export function evaluate(
  detector: EvalDetector,
  dataset: string,
  items: readonly TextItem[],
  alpha: number,
): DetectorReport {
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
  const threshold = conformalThreshold(
    human.map((s) => s.score),
    alpha,
  );
  const warnings: string[] = [
    'In-sample calibration (M0 harness check). Do not quote these numbers.',
  ];
  if (!Number.isFinite(threshold))
    warnings.push(
      `Only ${human.length} human items: too few to guarantee FPR <= ${alpha}. Nothing is flagged.`,
    );
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
    warnings,
  };
}

const fmt = (x: number) => (Number.isNaN(x) ? 'n/a' : Number.isFinite(x) ? x.toFixed(3) : 'inf');
const pct = (x: number) => (Number.isNaN(x) ? 'n/a' : `${(x * 100).toFixed(1)}%`);

export function toMarkdown(reports: readonly DetectorReport[]): string {
  const lines = [`# Evaluation report: \`${reports[0]?.dataset ?? 'unknown'}\``, ''];
  for (const r of reports) {
    lines.push(
      `## ${r.detector}`,
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
    );
  }
  return lines.join('\n');
}
