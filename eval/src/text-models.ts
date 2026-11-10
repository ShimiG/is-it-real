/**
 * Trains and evaluates the text detectors from the committed feature table
 * (eval/features/text-features.v1.jsonl; see features.ts).
 *
 * Splits: `train` fits the weights, `calib` (human rows only) gives the conformal calibration
 * scores, `test` is only ever used for the numbers in the report.
 */
import { LM_FEATURES, TEXT_FEATURES, conformalScore, type LmFeature } from '@isitreal/core';
import type { FeatureRow } from './features.js';
import { fitLogReg, predict, type LogReg } from './logreg.js';
import { auroc } from './metrics.js';

export interface Spec {
  id: string;
  description: string;
  /** Feature names: `t0.<name>` or `lm.<name>`. */
  features: string[];
  /** false = zero-shot: the single feature is used as the score, nothing is trained. */
  trained: boolean;
}

const T0 = TEXT_FEATURES.map((f) => `t0.${f}`);
const LM = LM_FEATURES.map((f) => `lm.${f}`);

export const SPECS: Spec[] = [
  {
    id: 'text.stats@0.2.0',
    description: 'Tier 0 only: 18 text statistics, no model.',
    features: T0,
    trained: true,
  },
  {
    id: 'fast-detectgpt (zero-shot)',
    description: 'Fast-DetectGPT criterion from GPT-2 alone; nothing trained, only calibrated.',
    features: ['lm.fdCriterion'],
    trained: false,
  },
  {
    id: 'lm-features',
    description: 'All 11 language-model features, logistic model.',
    features: LM,
    trained: true,
  },
  {
    id: 'text.ensemble@0.2.0',
    description: 'Tier 0 statistics + language-model features, logistic model. This is what ships.',
    features: [...T0, ...LM],
    trained: true,
  },
];

export const usable = (r: FeatureRow) => r.lm !== null;

export function vector(r: FeatureRow, spec: Spec): number[] {
  return spec.features.map((name) => {
    const key = name.slice(3);
    return name.startsWith('lm.')
      ? r.lm![LM_FEATURES.indexOf(key as LmFeature)]!
      : r.t0[(TEXT_FEATURES as readonly string[]).indexOf(key)]!;
  });
}

export interface Fitted {
  spec: Spec;
  logreg: LogReg | null;
  /** Ascending raw scores of human calibration rows. */
  calibration: number[];
}

export function rawScore(f: Fitted, r: FeatureRow): number {
  const x = vector(r, f.spec);
  return f.logreg === null ? x[0]! : predict(f.logreg, x);
}

/** Fit on `train` rows (class-balanced) and calibrate on human `calib` rows. */
export function fit(
  spec: Spec,
  train: readonly FeatureRow[],
  calib: readonly FeatureRow[],
): Fitted {
  let logreg: LogReg | null = null;
  if (spec.trained) {
    const nAi = train.filter((r) => r.truth === 'ai').length;
    const nHuman = train.length - nAi;
    logreg = fitLogReg(
      train.map((r) => vector(r, spec)),
      train.map((r) => (r.truth === 'ai' ? 1 : 0)),
      {
        weights: train.map((r) => (r.truth === 'ai' ? nHuman / nAi : 1)),
        l2: 0.01,
        epochs: 1500,
        lr: 0.3,
      },
    );
  }
  const f: Fitted = { spec, logreg, calibration: [] };
  f.calibration = calib
    .filter((r) => r.truth === 'human')
    .map((r) => rawScore(f, r))
    .sort((a, b) => a - b);
  return f;
}

export interface GroupStat {
  subgroup: string;
  truth: 'ai' | 'human';
  n: number;
  notAssessed: number;
  flagged: number;
}

export interface SpecReport {
  id: string;
  description: string;
  alpha: number;
  calibrationSize: number;
  /** In-distribution: Ghostbuster test split (essays, news, stories; ChatGPT and Claude). */
  auroc: number;
  detectionRate: number;
  /** Pooled over every human test row that passed the gates. */
  falsePositiveRate: number;
  humanTested: number;
  groups: GroupStat[];
}

const CORE = new Set(['essay', 'news', 'stories']);
export const isCore = (r: FeatureRow) =>
  r.dataset === 'ghostbuster' && CORE.has(r.subgroup.split('/')[0]!);

export function evaluateFitted(f: Fitted, rows: readonly FeatureRow[], alpha: number): SpecReport {
  const flaggedRow = (r: FeatureRow) => conformalScore(rawScore(f, r), f.calibration) >= 1 - alpha;
  const test = rows.filter((r) => r.split === 'test');
  const groups = new Map<string, GroupStat>();
  for (const r of test) {
    const g = groups.get(r.subgroup) ?? {
      subgroup: r.subgroup,
      truth: r.truth,
      n: 0,
      notAssessed: 0,
      flagged: 0,
    };
    g.n++;
    if (!usable(r)) g.notAssessed++;
    else if (flaggedRow(r)) g.flagged++;
    groups.set(r.subgroup, g);
  }
  const core = test.filter((r) => isCore(r) && usable(r));
  const coreAi = core.filter((r) => r.truth === 'ai');
  const humans = test.filter((r) => r.truth === 'human' && usable(r));
  return {
    id: f.spec.id,
    description: f.spec.description,
    alpha,
    calibrationSize: f.calibration.length,
    auroc: auroc(
      core.map((r) => ({ truth: r.truth, score: rawScore(f, r), subgroup: r.subgroup })),
    ),
    detectionRate: coreAi.filter(flaggedRow).length / Math.max(1, coreAi.length),
    falsePositiveRate: humans.filter(flaggedRow).length / Math.max(1, humans.length),
    humanTested: humans.length,
    groups: [...groups.values()].sort((a, b) =>
      (a.truth + a.subgroup).localeCompare(b.truth + b.subgroup),
    ),
  };
}

export interface LodoRow {
  heldOut: string;
  n: number;
  auroc: number;
  detectionRate: number;
  falsePositiveRate: number;
}

/**
 * Leave one kind of text out: train and calibrate without it, then test on it. Shows whether
 * both the ranking AND the false-alarm guarantee carry over to unseen kinds of text.
 */
export function leaveOneDomainOut(
  spec: Spec,
  rows: readonly FeatureRow[],
  alpha: number,
): LodoRow[] {
  const ok = rows.filter(
    (r) => usable(r) && r.dataset === 'ghostbuster' && r.subgroup !== 'humanizer-rewritten',
  );
  return [...CORE].sort().map((d) => {
    const inD = (r: FeatureRow) => r.subgroup.split('/')[0] === d;
    const f = fit(
      spec,
      ok.filter((r) => !inD(r) && r.split === 'train'),
      ok.filter((r) => !inD(r) && r.split === 'calib'),
    );
    const held = ok.filter(inD);
    const flaggedRow = (r: FeatureRow) =>
      conformalScore(rawScore(f, r), f.calibration) >= 1 - alpha;
    const ai = held.filter((r) => r.truth === 'ai');
    const human = held.filter((r) => r.truth === 'human');
    return {
      heldOut: d,
      n: held.length,
      auroc: auroc(held.map((r) => ({ truth: r.truth, score: rawScore(f, r), subgroup: d }))),
      detectionRate: ai.filter(flaggedRow).length / Math.max(1, ai.length),
      falsePositiveRate: human.filter(flaggedRow).length / Math.max(1, human.length),
    };
  });
}

export function fitAll(rows: readonly FeatureRow[]): Fitted[] {
  const ok = rows.filter(usable);
  const train = ok.filter((r) => r.split === 'train');
  const calib = ok.filter((r) => r.split === 'calib');
  return SPECS.map((s) => fit(s, train, calib));
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function textReportMarkdown(
  reports: readonly SpecReport[],
  lodo: readonly LodoRow[],
  rows: readonly FeatureRow[],
): string {
  const alpha = reports[0]!.alpha;
  const ship = reports.find((r) => r.id.startsWith('text.ensemble'))!;
  const counts = (s: string) => rows.filter((r) => r.split === s).length;
  const lines = [
    '## Text detectors (feature table)',
    '',
    `${rows.length} texts: train ${counts('train')}, calibration ${counts('calib')}, test ${counts('test')}. Flag rule: conformal score >= ${1 - alpha} (target false-alarm rate ${pct(alpha)}), calibrated on ${ship.calibrationSize} human texts.`,
    '',
    '### Detectors compared (held-out test split)',
    '',
    '| Detector | AUROC (essays, news, stories) | AI detected | Human flagged (all human test sets) |',
    '|---|---|---|---|',
    ...reports.map(
      (r) =>
        `| ${r.id} | ${r.auroc.toFixed(3)} | ${pct(r.detectionRate)} | ${pct(r.falsePositiveRate)} of ${r.humanTested} |`,
    ),
    '',
    ...reports.map((r) => `- **${r.id}:** ${r.description}`),
    '',
    `### ${ship.id} by group`,
    '',
    '**Human-written test sets (bias table): how many were wrongly flagged**',
    '',
    '| Group | Texts | Not assessed (too short) | Assessed | Wrongly flagged |',
    '|---|---|---|---|---|',
    ...ship.groups
      .filter((g) => g.truth === 'human')
      .map((g) => {
        const a = g.n - g.notAssessed;
        return `| ${g.subgroup} | ${g.n} | ${g.notAssessed} | ${a} | ${g.flagged} (${a === 0 ? 'n/a' : pct(g.flagged / a)}) |`;
      }),
    '',
    '**AI-written test sets: how many were caught**',
    '',
    '| Group | Texts | Not assessed | Assessed | Caught |',
    '|---|---|---|---|---|',
    ...ship.groups
      .filter((g) => g.truth === 'ai')
      .map((g) => {
        const a = g.n - g.notAssessed;
        return `| ${g.subgroup} | ${g.n} | ${g.notAssessed} | ${a} | ${g.flagged} (${a === 0 ? 'n/a' : pct(g.flagged / a)}) |`;
      }),
    '',
    `### ${ship.id} on a kind of text it never saw`,
    '',
    'Trained and calibrated without one kind of text, then tested on it.',
    '',
    '| Held out | Texts | AUROC | AI caught | Human wrongly flagged |',
    '|---|---|---|---|---|',
    ...lodo.map(
      (l) =>
        `| ${l.heldOut} | ${l.n} | ${l.auroc.toFixed(3)} | ${pct(l.detectionRate)} | ${pct(l.falsePositiveRate)} |`,
    ),
    '',
  ];
  return lines.join('\n');
}
