/**
 * Evaluates image classifiers from the committed score table (eval/features/image-scores.v1.jsonl,
 * written by eval/reference/image_eval.py). Same honest rule as text: calibrate a conformal
 * threshold on held-out REAL photos (split "calib", each photo's highest score across its views),
 * then report on the test
 * split only: AI caught per source and view, real photos wrongly flagged per view.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { conformalScore } from '@isitreal/core';
import { auroc } from './metrics.js';

export const IMAGE_SCORES_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'features',
  'image-scores.v1.jsonl',
);

export interface ImageScoreRow {
  id: string;
  source: string;
  truth: 'ai' | 'real';
  split: 'calib' | 'test';
  view: string;
  width: number;
  height: number;
  scores: Record<string, number>;
}

export function loadImageScores(path = IMAGE_SCORES_FILE): ImageScoreRow[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.startsWith('{'))
    .map((l) => JSON.parse(l) as ImageScoreRow);
}

export interface Cell {
  n: number;
  flagged: number;
  /** Images the photo gate kept away from the model ("Not checked"). */
  notChecked: number;
}

export interface ImageModelReport {
  model: string;
  /** Which non-AI sources the calibration used. */
  calibrationSources: string[];
  calibrationSize: number;
  gated: boolean;
  /** AUROC of stock-style real photos (source "real", test) vs AI, per view (gate not applied). */
  auroc: Record<string, number>;
  /** Non-AI test images wrongly flagged, per source and view. */
  realFlagged: Record<string, Record<string, Cell>>;
  /** AI images caught, per source and view. */
  aiCaught: Record<string, Record<string, Cell>>;
}

/** The stock-style photo source (Open Images). */
export const PHOTO_SOURCE = 'real';

export interface GateScores {
  /** Gate score per `${id}|${view}`. */
  scores: Map<string, number>;
  threshold: number;
}

export function loadGateScores(path: string, threshold: number): GateScores | null {
  if (!existsSync(path)) return null;
  const scores = new Map<string, number>();
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.startsWith('{')) continue;
    const r = JSON.parse(line) as { id: string; view: string; gate: number };
    scores.set(`${r.id}|${r.view}`, r.gate);
  }
  return { scores, threshold };
}

export interface EvalOptions {
  alpha?: number;
  /** Non-AI sources whose calibration split sets the threshold; default: every non-AI source. */
  calibrationSources?: readonly string[];
  /** When given, only images that pass the photo gate are judged (and used for calibration). */
  gate?: GateScores | null;
}

export function evaluateImageModels(
  rows: readonly ImageScoreRow[],
  options: EvalOptions = {},
): ImageModelReport[] {
  const alpha = options.alpha ?? 0.01;
  const gate = options.gate ?? null;
  const passes = (r: ImageScoreRow) =>
    gate === null || (gate.scores.get(`${r.id}|${r.view}`) ?? 0) >= gate.threshold;
  const calibrationSources =
    options.calibrationSources ??
    [...new Set(rows.filter((r) => r.truth === 'real').map((r) => r.source))].sort();
  const models = [...new Set(rows.flatMap((r) => Object.keys(r.scores)))].sort();
  const views = [...new Set(rows.map((r) => r.view))].sort(
    (a, b) => VIEW_ORDER.indexOf(a) - VIEW_ORDER.indexOf(b),
  );
  return models.map((model) => {
    const has = rows.filter((r) => r.scores[model] !== undefined);
    // An image is judged once, in an unknown condition: calibrate on each image's HIGHEST score
    // across its versions, so false alarms stay at or below alpha in every condition. With a gate,
    // only images that pass it in at least one version belong to the judged population.
    const worst = new Map<string, number>();
    const passing = new Set<string>();
    for (const r of has.filter(
      (x) => x.truth === 'real' && x.split === 'calib' && calibrationSources.includes(x.source),
    )) {
      worst.set(r.id, Math.max(worst.get(r.id) ?? -Infinity, r.scores[model]!));
      if (passes(r)) passing.add(r.id);
    }
    const calibration = [...worst.entries()]
      .filter(([id]) => passing.has(id))
      .map(([, v]) => v)
      .sort((a, b) => a - b);
    const flagged = (r: ImageScoreRow) =>
      passes(r) && conformalScore(r.scores[model]!, calibration) >= 1 - alpha;
    const test = has.filter((r) => r.split === 'test');
    const report: ImageModelReport = {
      model,
      calibrationSources: [...calibrationSources],
      calibrationSize: calibration.length,
      gated: gate !== null,
      auroc: {},
      realFlagged: {},
      aiCaught: {},
    };
    const sourcesOf = (truth: 'ai' | 'real') =>
      [...new Set(test.filter((r) => r.truth === truth).map((r) => r.source))].sort((a, b) =>
        a === PHOTO_SOURCE ? -1 : b === PHOTO_SOURCE ? 1 : a.localeCompare(b),
      );
    for (const view of views) {
      const v = test.filter((r) => r.view === view);
      report.auroc[view] = auroc(
        v
          .filter((r) => r.truth === 'ai' || r.source === PHOTO_SOURCE)
          .map((r) => ({
            truth: r.truth === 'ai' ? ('ai' as const) : ('human' as const),
            score: r.scores[model]!,
            subgroup: r.source,
          })),
      );
      for (const truth of ['real', 'ai'] as const) {
        for (const source of sourcesOf(truth)) {
          const group = v.filter((r) => r.source === source && r.truth === truth);
          const target = truth === 'real' ? report.realFlagged : report.aiCaught;
          (target[source] ??= {})[view] = {
            n: group.length,
            flagged: group.filter(flagged).length,
            notChecked: group.filter((r) => !passes(r)).length,
          };
        }
      }
    }
    return report;
  });
}

const VIEW_ORDER = ['original', 'social', 'harsh'];

const pct = (c: Cell | undefined, gated: boolean) => {
  if (c === undefined || c.n === 0) return 'n/a';
  const base = `${c.flagged}/${c.n} (${((100 * c.flagged) / c.n).toFixed(1)}%)`;
  return gated ? `${base}, not checked ${((100 * c.notChecked) / c.n).toFixed(0)}%` : base;
};

const LABELS: Record<string, string> = {
  real: 'stock-style photos (Open Images)',
  phone: 'phone photos (SPAQ)',
  screenshot: 'screenshots',
  meme: 'memes',
  cartoon: 'cartoons',
  digital_art: 'digital art',
  sketch: 'sketches',
  cosplay: 'cosplay and stage photos',
};
const label = (s: string) => LABELS[s] ?? s;

export function imageReportMarkdown(
  reports: readonly ImageModelReport[],
  alpha = 0.01,
  title = 'Image classifiers (score table)',
): string {
  if (reports.length === 0) return '';
  const views = Object.keys(reports[0]!.auroc);
  const lines = [
    `## ${title}`,
    '',
    `Flag rule: conformal score >= ${1 - alpha}${reports[0]!.gated ? ', only for images that pass the photo gate (others are "not checked")' : ''}. Calibrated on the calibration split of: ${reports[0]!.calibrationSources.map(label).join(', ')} (each image's highest score across its versions). Numbers are for the test split only.`,
    '',
  ];
  for (const r of reports) {
    lines.push(
      `### ${r.model} (calibration: ${r.calibrationSize} images)`,
      '',
      `| | ${views.join(' | ')} |`,
      `|---|${views.map(() => '---').join('|')}|`,
      `| AUROC (photos vs AI) | ${views.map((v) => (Number.isNaN(r.auroc[v]) ? 'n/a' : r.auroc[v]!.toFixed(3))).join(' | ')} |`,
      ...Object.entries(r.realFlagged).map(
        ([source, byView]) =>
          `| Wrongly flagged: ${label(source)} | ${views.map((v) => pct(byView[v], r.gated)).join(' | ')} |`,
      ),
      ...Object.entries(r.aiCaught).map(
        ([source, byView]) =>
          `| AI caught: ${source} | ${views.map((v) => pct(byView[v], r.gated)).join(' | ')} |`,
      ),
      '',
    );
  }
  return lines.join('\n');
}
