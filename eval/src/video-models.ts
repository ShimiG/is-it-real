/**
 * Evaluates the experimental video frame check from the committed score table
 * (eval/features/video-scores.v1.jsonl, written by eval/reference/video_eval.py).
 *
 * A video gets one number: the median raw picture-model score of its sampled frames that pass the
 * photo gate (packages/core/src/video/frames.ts). Same honest rule as for images: the threshold is
 * a conformal cut-off from held-out NON-AI videos (calibration half, each video's highest number
 * over all the ways it was scored); every reported number comes from the test half.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { conformalScore, median } from '@isitreal/core';

export const VIDEO_SCORES_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'features',
  'video-scores.v1.jsonl',
);

export interface VideoScoreRow {
  id: string;
  source: string;
  truth: 'ai' | 'real';
  split: 'calib' | 'test';
  version: string;
  /** Photo-gate score and raw picture-model score of each sampled frame. */
  gate?: number[];
  logit?: number[];
  error?: string;
}

/**
 * The same clips scored the way the browser extension sees a PLAYING video: 6 frames about a
 * second apart from one place in the clip (eval/reference/video_window_eval.py).
 */
export const VIDEO_WINDOW_SCORES_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'features',
  'video-window-scores.v1.jsonl',
);

function readRows(path: string): VideoScoreRow[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.startsWith('{'))
    .map((l) => JSON.parse(l) as VideoScoreRow);
}

/**
 * Every scored clip version: `original` and `reshared` (frames spread over the whole clip), and,
 * when the second table exists, `watched` and `watched-reshared` (frames from one place, as when
 * a video plays in the browser).
 */
export function loadVideoScores(
  path = VIDEO_SCORES_FILE,
  windowPath = VIDEO_WINDOW_SCORES_FILE,
): VideoScoreRow[] {
  return [
    ...readRows(path),
    ...readRows(windowPath).map((r) => ({
      ...r,
      version: r.version === 'original' ? 'watched' : 'watched-reshared',
    })),
  ];
}

export interface VideoRule {
  /** Frames at or above this gate score are judged. */
  gateThreshold: number;
  /** At least this many frames must pass the gate. */
  minChecked: number;
}

/** The video's number under a rule; null when too few frames can be judged ("not checked"). */
export function videoStatistic(row: VideoScoreRow, rule: VideoRule): number | null {
  const gate = row.gate ?? [];
  const logit = row.logit ?? [];
  const judged = logit.filter((_, i) => (gate[i] ?? 0) >= rule.gateThreshold);
  return judged.length >= rule.minChecked ? median(judged) : null;
}

export interface VideoCell {
  n: number;
  flagged: number;
  notChecked: number;
}

export interface VideoReport {
  rule: VideoRule;
  calibrationSize: number;
  calibrationSources: Record<string, number>;
  /** The sorted calibration numbers (what ships in video-frames.model.json). */
  calibration: number[];
  /** Raw number above which a video is flagged. */
  cutoff: number;
  /** Per source and version, test half only. */
  realFlagged: Record<string, Record<string, VideoCell>>;
  aiCaught: Record<string, Record<string, VideoCell>>;
}

const VERSION_ORDER = ['original', 'reshared', 'watched', 'watched-reshared'];

export function evaluateVideoFrames(
  rows: readonly VideoScoreRow[],
  rule: VideoRule,
  alpha = 0.01,
): VideoReport {
  // Calibration: each non-AI calibration video's highest number over all its versions.
  const worst = new Map<string, number>();
  const sourceOf = new Map<string, string>();
  for (const r of rows) {
    if (r.truth !== 'real' || r.split !== 'calib') continue;
    const s = videoStatistic(r, rule);
    if (s === null) continue;
    worst.set(r.id, Math.max(worst.get(r.id) ?? -Infinity, s));
    sourceOf.set(r.id, r.source);
  }
  const calibration = [...worst.values()].sort((a, b) => a - b);
  const calibrationSources: Record<string, number> = {};
  for (const s of sourceOf.values()) calibrationSources[s] = (calibrationSources[s] ?? 0) + 1;
  const flagged = (s: number) => conformalScore(s, calibration) >= 1 - alpha;
  const n = calibration.length;
  const report: VideoReport = {
    rule,
    calibrationSize: n,
    calibrationSources,
    calibration,
    cutoff: n === 0 ? NaN : calibration[Math.min(n - 1, Math.ceil((1 - alpha) * (n + 1)) - 1)]!,
    realFlagged: {},
    aiCaught: {},
  };
  for (const r of rows) {
    if (r.split !== 'test') continue;
    const target = r.truth === 'real' ? report.realFlagged : report.aiCaught;
    const cell = ((target[r.source] ??= {})[r.version] ??= { n: 0, flagged: 0, notChecked: 0 });
    cell.n++;
    const s = videoStatistic(r, rule);
    if (s === null) cell.notChecked++;
    else if (flagged(s)) cell.flagged++;
  }
  return report;
}

const LABELS: Record<string, string> = {
  msrvtt: 'YouTube clips, 2016, small (MSR-VTT)',
  openvid: 'YouTube clips, HD (OpenVid-1M)',
  dfd_real: 'studio recordings of actors (DeepFakeDetection originals)',
  dfd_fake: 'face swaps of those actors (DeepFakeDetection, 2019)',
  portrait: 'AI talking portraits (Kling, Luma, Pika, PixVerse, Runway, Sora)',
  sora2: 'Sora 2',
  sora1: 'Sora (first version)',
  veo31: 'Veo 3.1',
  veo3: 'Veo 3',
  veo2: 'Veo 2',
  kling: 'Kling',
  seedance: 'Seedance 1 Pro',
  wan21: 'Wan 2.1',
  ray2: 'Luma Ray 2',
  pika22: 'Pika 2.2',
  runway: 'Runway Gen-3 Alpha',
  hunyuan: 'HunyuanVideo',
  mochi: 'Mochi 1',
};
export const videoLabel = (s: string) => LABELS[s] ?? s;

const cellText = (c: VideoCell | undefined) =>
  c === undefined || c.n === 0
    ? 'n/a'
    : `${c.flagged}/${c.n} (${((100 * c.flagged) / c.n).toFixed(1)}%), not checked ${((100 * c.notChecked) / c.n).toFixed(0)}%`;

const total = (cells: Record<string, Record<string, VideoCell>>, version: string): VideoCell => {
  const t = { n: 0, flagged: 0, notChecked: 0 };
  for (const byVersion of Object.values(cells)) {
    const c = byVersion[version];
    if (c === undefined) continue;
    t.n += c.n;
    t.flagged += c.flagged;
    t.notChecked += c.notChecked;
  }
  return t;
};

export function videoReportMarkdown(report: VideoReport, alpha = 0.01): string {
  if (report.calibrationSize === 0) return '';
  const present = new Set(
    [...Object.values(report.realFlagged), ...Object.values(report.aiCaught)].flatMap((c) =>
      Object.keys(c),
    ),
  );
  const versions = VERSION_ORDER.filter((v) => present.has(v));
  const order = (cells: Record<string, unknown>) => Object.keys(cells).sort();
  const mix = Object.entries(report.calibrationSources)
    .map(([s, c]) => `${c} ${s}`)
    .join(', ');
  return [
    '## Video frame check (experimental)',
    '',
    `A video's number is the median picture-model score of its sampled frames that pass the photo gate (gate >= ${report.rule.gateThreshold}); with fewer than ${report.rule.minChecked} such frames the video is "not checked". Flag rule: conformal score >= ${1 - alpha}, calibrated on ${report.calibrationSize} non-AI calibration videos (${mix}; each video's highest number over its versions). Raw cut-off: ${report.cutoff.toFixed(2)}. Numbers are for the test half only. Versions: \`original\` and \`reshared\` take 6 frames spread over the whole clip (a video file); \`watched\` and \`watched-reshared\` take 6 frames about a second apart from one place (a video playing in the browser).`,
    '',
    `| | ${versions.join(' | ')} |`,
    `|---|${versions.map(() => '---').join('|')}|`,
    ...order(report.realFlagged).map(
      (s) =>
        `| Wrongly flagged: ${videoLabel(s)} | ${versions.map((v) => cellText(report.realFlagged[s]![v])).join(' | ')} |`,
    ),
    `| **Wrongly flagged: all non-AI videos** | ${versions.map((v) => cellText(total(report.realFlagged, v))).join(' | ')} |`,
    ...order(report.aiCaught).map(
      (s) =>
        `| AI caught: ${videoLabel(s)} | ${versions.map((v) => cellText(report.aiCaught[s]![v])).join(' | ')} |`,
    ),
    `| **AI caught: all AI videos** | ${versions.map((v) => cellText(total(report.aiCaught, v))).join(' | ')} |`,
    '',
  ].join('\n');
}
