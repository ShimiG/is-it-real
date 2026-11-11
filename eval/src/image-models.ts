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
  calibrationSize: number;
  /** AUROC of real (test) vs AI per view. */
  auroc: Record<string, number>;
  /** Real test photos wrongly flagged, per view. */
  realFlagged: Record<string, Cell>;
  /** AI images caught, per source and view. */
  aiCaught: Record<string, Record<string, Cell>>;
}

export function evaluateImageModels(
  rows: readonly ImageScoreRow[],
  alpha = 0.01,
): ImageModelReport[] {
  const models = [...new Set(rows.flatMap((r) => Object.keys(r.scores)))].sort();
  const views = [...new Set(rows.map((r) => r.view))];
  return models.map((model) => {
    const has = rows.filter((r) => r.scores[model] !== undefined);
    // An image is judged once, in an unknown condition: calibrate on each real photo's HIGHEST
    // score across its views, so false alarms stay at or below alpha in every condition.
    const worst = new Map<string, number>();
    for (const r of has.filter((x) => x.truth === 'real' && x.split === 'calib'))
      worst.set(r.id, Math.max(worst.get(r.id) ?? -Infinity, r.scores[model]!));
    const calibration = [...worst.values()].sort((a, b) => a - b);
    const flagged = (r: ImageScoreRow) =>
      conformalScore(r.scores[model]!, calibration) >= 1 - alpha;
    const test = has.filter((r) => r.split === 'test');
    const report: ImageModelReport = {
      model,
      calibrationSize: calibration.length,
      auroc: {},
      realFlagged: {},
      aiCaught: {},
    };
    for (const view of views) {
      const v = test.filter((r) => r.view === view);
      const real = v.filter((r) => r.truth === 'real');
      report.realFlagged[view] = { n: real.length, flagged: real.filter(flagged).length };
      report.auroc[view] = auroc(
        v.map((r) => ({
          truth: r.truth === 'ai' ? ('ai' as const) : ('human' as const),
          score: r.scores[model]!,
          subgroup: r.source,
        })),
      );
      for (const source of [
        ...new Set(v.filter((r) => r.truth === 'ai').map((r) => r.source)),
      ].sort()) {
        const ai = v.filter((r) => r.source === source && r.truth === 'ai');
        (report.aiCaught[source] ??= {})[view] = {
          n: ai.length,
          flagged: ai.filter(flagged).length,
        };
      }
    }
    return report;
  });
}

const pct = (c: Cell | undefined) =>
  c === undefined || c.n === 0
    ? 'n/a'
    : `${c.flagged}/${c.n} (${((100 * c.flagged) / c.n).toFixed(1)}%)`;

export function imageReportMarkdown(reports: readonly ImageModelReport[], alpha = 0.01): string {
  if (reports.length === 0) return '';
  const views = Object.keys(reports[0]!.realFlagged);
  const lines = [
    '## Image classifiers (score table)',
    '',
    `Flag rule: conformal score >= ${1 - alpha}, calibrated on held-out real photos (each photo's highest score across its views). Test split only.`,
    '',
  ];
  for (const r of reports) {
    lines.push(
      `### ${r.model} (calibration: ${r.calibrationSize} real photos)`,
      '',
      `| | ${views.join(' | ')} |`,
      `|---|${views.map(() => '---').join('|')}|`,
      `| AUROC | ${views.map((v) => (Number.isNaN(r.auroc[v]) ? 'n/a' : r.auroc[v]!.toFixed(3))).join(' | ')} |`,
      `| Real photos wrongly flagged | ${views.map((v) => pct(r.realFlagged[v])).join(' | ')} |`,
      ...Object.entries(r.aiCaught).map(
        ([source, byView]) =>
          `| AI caught: ${source} | ${views.map((v) => pct(byView[v])).join(' | ')} |`,
      ),
      '',
    );
  }
  return lines.join('\n');
}
