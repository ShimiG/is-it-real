import { describe, expect, it } from 'vitest';
import {
  evaluateVideoFrames,
  videoReportMarkdown,
  videoStatistic,
  type VideoScoreRow,
} from '../src/video-models.js';

const rule = { gateThreshold: 0.5, minChecked: 4 };
const row = (
  id: string,
  truth: 'ai' | 'real',
  split: 'calib' | 'test',
  version: string,
  logit: number[],
  gate: number[] = logit.map(() => 0.9),
  source = truth === 'ai' ? 'gen' : 'cam',
): VideoScoreRow => ({ id, source, truth, split, version, gate, logit });
const six = (v: number) => new Array<number>(6).fill(v);

describe('videoStatistic', () => {
  it('is the median of the frames that pass the gate', () => {
    expect(videoStatistic(row('a', 'ai', 'test', 'original', [1, 2, 3, 4, 5, 6]), rule)).toBe(3.5);
    // Two frames fail the gate: the median is over the other four.
    const gated = row(
      'a',
      'ai',
      'test',
      'original',
      [9, 9, 1, 2, 3, 4],
      [0.1, 0.2, 0.9, 0.9, 0.9, 0.9],
    );
    expect(videoStatistic(gated, rule)).toBe(2.5);
  });

  it('is null when too few frames can be judged, or the clip could not be read', () => {
    const few = row('a', 'ai', 'test', 'original', six(9), [0.9, 0.9, 0.9, 0.1, 0.1, 0.1]);
    expect(videoStatistic(few, rule)).toBeNull();
    expect(
      videoStatistic(
        {
          id: 'x',
          source: 's',
          truth: 'real',
          split: 'test',
          version: 'original',
          error: 'unreadable',
        },
        rule,
      ),
    ).toBeNull();
  });
});

describe('evaluateVideoFrames', () => {
  // 200 real calibration videos whose original scores 0..1.99 and whose re-shared copy scores 0.5 higher.
  const rows: VideoScoreRow[] = [
    ...Array.from({ length: 200 }, (_, i) => [
      row(`c${i}`, 'real', 'calib', 'original', six(i / 100)),
      row(`c${i}`, 'real', 'calib', 'reshared', six(i / 100 + 0.5)),
    ]).flat(),
    ...Array.from({ length: 100 }, (_, i) => row(`t${i}`, 'real', 'test', 'original', six(i / 50))),
    ...Array.from({ length: 10 }, (_, i) => row(`a${i}`, 'ai', 'test', 'original', six(3))),
    ...Array.from({ length: 10 }, (_, i) =>
      row(`b${i}`, 'ai', 'test', 'original', six(2.2), undefined, 'weak'),
    ),
    ...Array.from({ length: 10 }, (_, i) =>
      row(`g${i}`, 'ai', 'test', 'original', six(9), six(0.1), 'cartoon'),
    ),
  ];
  const report = evaluateVideoFrames(rows, rule);

  it('calibrates on the higher of the two versions of each real calibration video', () => {
    expect(report.calibrationSize).toBe(200);
    expect(report.calibrationSources).toEqual({ cam: 200 });
    expect(report.calibration[0]).toBeCloseTo(0.5, 9);
    expect(report.calibration.at(-1)).toBeCloseTo(2.49, 9);
    expect(report.cutoff).toBeCloseTo(2.48, 9);
  });

  it('reports caught, missed and not-checked videos per source on the test half only', () => {
    expect(report.aiCaught['gen']!['original']).toEqual({ n: 10, flagged: 10, notChecked: 0 });
    expect(report.aiCaught['weak']!['original']).toEqual({ n: 10, flagged: 0, notChecked: 0 });
    expect(report.aiCaught['cartoon']!['original']).toEqual({ n: 10, flagged: 0, notChecked: 10 });
    expect(report.realFlagged['cam']!['original']).toEqual({ n: 100, flagged: 0, notChecked: 0 });
  });

  it('writes a readable table', () => {
    const md = videoReportMarkdown(report);
    expect(md).toContain('## Video frame check (experimental)');
    // Only the versions that were scored get a column.
    expect(md).toContain('| | original |\n');
    expect(md).toContain('| AI caught: gen | 10/10 (100.0%), not checked 0% |\n');
    expect(md).toContain('| **AI caught: all AI videos** | 10/30 (33.3%), not checked 33% |');
    expect(videoReportMarkdown(evaluateVideoFrames([], rule))).toBe('');
  });
});
