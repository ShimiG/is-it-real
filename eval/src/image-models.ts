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
}

export interface ImageModelReport {
  model: string;
  /** Which non-AI sources the calibration used. */
  calibrationSources: string[];
  calibrationSize: number;
  /** AUROC of stock-style real photos (source "real", test) vs AI, per view. */
  auroc: Record<string, number>;
  /** Non-AI test images wrongly flagged, per source and view. */
  realFlagged: Record<string, Record<string, Cell>>;
  /** AI images caught, per source and view. */
  aiCaught: Record<string, Record<string, Cell>>;
}

/** The stock-style photo source (Open Images) that the shipped calibration uses. */
export const PHOTO_SOURCE = 'real';

/**
 * @param calibrationSources non-AI sources whose calibration split sets the threshold
 *   (default: stock-style photos only, like the shipped model).
 */
export function evaluateImageModels(
  rows: readonly ImageScoreRow[],
  alpha = 0.01,
  calibrationSources: readonly string[] = [PHOTO_SOURCE],
): ImageModelReport[] {
  const models = [...new Set(rows.flatMap((r) => Object.keys(r.scores)))].sort();
  const views = [...new Set(rows.map((r) => r.view))];
  return models.map((model) => {
    const has = rows.filter((r) => r.scores[model] !== undefined);
    // An image is judged once, in an unknown condition: calibrate on each image's HIGHEST
    // score across its views, so false alarms stay at or below alpha in every condition.
    const worst = new Map<string, number>();
    for (const r of has.filter(
      (x) => x.truth === 'real' && x.split === 'calib' && calibrationSources.includes(x.source),
    ))
      worst.set(r.id, Math.max(worst.get(r.id) ?? -Infinity, r.scores[model]!));
    const calibration = [...worst.values()].sort((a, b) => a - b);
    const flagged = (r: ImageScoreRow) =>
      conformalScore(r.scores[model]!, calibration) >= 1 - alpha;
    const test = has.filter((r) => r.split === 'test');
    const report: ImageModelReport = {
      model,
      calibrationSources: [...calibrationSources],
      calibrationSize: calibration.length,
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
          };
        }
      }
    }
    return report;
  });
}

const pct = (c: Cell | undefined) =>
  c === undefined || c.n === 0
    ? 'n/a'
    : `${c.flagged}/${c.n} (${((100 * c.flagged) / c.n).toFixed(1)}%)`;

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
    `Flag rule: conformal score >= ${1 - alpha}. Calibrated on the calibration split of: ${reports[0]!.calibrationSources.map(label).join(', ')} (each image's highest score across its views). Numbers are for the test split only.`,
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
          `| Wrongly flagged: ${label(source)} | ${views.map((v) => pct(byView[v])).join(' | ')} |`,
      ),
      ...Object.entries(r.aiCaught).map(
        ([source, byView]) =>
          `| AI caught: ${source} | ${views.map((v) => pct(byView[v])).join(' | ')} |`,
      ),
      '',
    );
  }
  return lines.join('\n');
}
