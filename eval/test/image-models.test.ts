import { describe, expect, it } from 'vitest';
import {
  evaluateImageModels,
  imageReportMarkdown,
  type ImageScoreRow,
} from '../src/image-models.js';

const row = (
  id: string,
  truth: 'ai' | 'real',
  split: 'calib' | 'test',
  view: string,
  score: number,
  source = truth === 'ai' ? 'gen' : 'real',
): ImageScoreRow => ({
  id,
  source,
  truth,
  split,
  view,
  width: 1000,
  height: 800,
  scores: { m: score },
});

describe('evaluateImageModels', () => {
  // 200 real calibration photos scoring 0..1.99, real test photos in the same range, AI test scoring 2.5 (all caught) or 0.5 (missed).
  const rows: ImageScoreRow[] = [
    ...Array.from({ length: 200 }, (_, i) => row(`c${i}`, 'real', 'calib', 'original', i / 100)),
    ...Array.from({ length: 100 }, (_, i) => row(`t${i}`, 'real', 'test', 'original', i / 50)),
    ...Array.from({ length: 10 }, (_, i) => row(`a${i}`, 'ai', 'test', 'original', 2.5)),
    ...Array.from({ length: 10 }, (_, i) => row(`b${i}`, 'ai', 'test', 'original', 0.5, 'other')),
  ];

  it('calibrates on real calibration photos and reports per source', () => {
    const [r] = evaluateImageModels(rows);
    expect(r!.calibrationSize).toBe(200);
    expect(r!.aiCaught['gen']!['original']).toEqual({ n: 10, flagged: 10, notChecked: 0 });
    expect(r!.aiCaught['other']!['original']).toEqual({ n: 10, flagged: 0, notChecked: 0 });
    expect(r!.realFlagged['real']!['original']!.flagged).toBeLessThanOrEqual(2);
    expect(imageReportMarkdown([r!])).toMatch(/AI caught: gen \| 10\/10/);
  });

  it('never flags anything without enough calibration photos', () => {
    const few = rows.filter((r) => !(r.split === 'calib' && Number(r.id.slice(1)) >= 50));
    const [r] = evaluateImageModels(few);
    expect(r!.calibrationSize).toBe(50);
    expect(r!.aiCaught['gen']!['original']!.flagged).toBe(0);
  });

  it("calibrates on each real photo's highest score across its views", () => {
    const multi: ImageScoreRow[] = [
      ...Array.from({ length: 100 }, (_, i) => row(`c${i}`, 'real', 'calib', 'original', i / 100)),
      ...Array.from({ length: 100 }, (_, i) =>
        row(`c${i}`, 'real', 'calib', 'social', i / 100 + 5),
      ),
      row('a', 'ai', 'test', 'original', 4),
    ];
    const [r] = evaluateImageModels(multi);
    expect(r!.calibrationSize).toBe(100);
    // 4 is above every original-view score but below the social-view maxima: not flagged.
    expect(r!.aiCaught['gen']!['original']).toEqual({ n: 1, flagged: 0, notChecked: 0 });
  });

  it('reports other kinds of non-AI images separately and can add them to the calibration', () => {
    const mixed: ImageScoreRow[] = [
      ...Array.from({ length: 200 }, (_, i) => row(`c${i}`, 'real', 'calib', 'original', i / 100)),
      // Screenshots score much higher than photos.
      ...Array.from({ length: 200 }, (_, i) =>
        row(`sc${i}`, 'real', 'calib', 'original', 3 + i / 100, 'screenshot'),
      ),
      ...Array.from({ length: 50 }, (_, i) =>
        row(`st${i}`, 'real', 'test', 'original', 3 + i / 25, 'screenshot'),
      ),
      ...Array.from({ length: 10 }, (_, i) => row(`a${i}`, 'ai', 'test', 'original', 4.5)),
    ];
    const [photoOnly] = evaluateImageModels(mixed, { calibrationSources: ['real'] });
    expect(photoOnly!.calibrationSize).toBe(200);
    expect(photoOnly!.realFlagged['screenshot']!['original']).toMatchObject({ n: 50, flagged: 50 });
    expect(photoOnly!.aiCaught['gen']!['original']!.flagged).toBe(10);
    const [both] = evaluateImageModels(mixed, { calibrationSources: ['real', 'screenshot'] });
    expect(both!.calibrationSize).toBe(400);
    expect(both!.realFlagged['screenshot']!['original']!.flagged).toBeLessThanOrEqual(2);
    // The price: the AI images now fall under the higher threshold.
    expect(both!.aiCaught['gen']!['original']!.flagged).toBe(0);
  });

  it('with a photo gate, images that fail it are not checked and do not calibrate', () => {
    const mixed: ImageScoreRow[] = [
      ...Array.from({ length: 200 }, (_, i) => row(`c${i}`, 'real', 'calib', 'original', i / 100)),
      ...Array.from({ length: 200 }, (_, i) =>
        row(`sc${i}`, 'real', 'calib', 'original', 3 + i / 100, 'screenshot'),
      ),
      ...Array.from({ length: 50 }, (_, i) =>
        row(`st${i}`, 'real', 'test', 'original', 3 + i / 25, 'screenshot'),
      ),
      ...Array.from({ length: 10 }, (_, i) => row(`a${i}`, 'ai', 'test', 'original', 4.5)),
    ];
    // The gate passes everything except screenshots.
    const scores = new Map(
      mixed.map((r) => [`${r.id}|${r.view}`, r.source === 'screenshot' ? 0.1 : 0.9]),
    );
    const [r] = evaluateImageModels(mixed, { gate: { scores, threshold: 0.5 } });
    expect(r!.calibrationSize).toBe(200); // screenshots do not calibrate
    expect(r!.realFlagged['screenshot']!['original']).toEqual({
      n: 50,
      flagged: 0,
      notChecked: 50,
    });
    expect(r!.aiCaught['gen']!['original']).toEqual({ n: 10, flagged: 10, notChecked: 0 });
    expect(imageReportMarkdown([r!])).toMatch(/not checked 100%/);
  });
});
