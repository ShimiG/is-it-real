import { describe, expect, it } from 'vitest';
import { fitLogReg, predict } from '../src/logreg.js';
import { splitOf } from '../src/split.js';

describe('fitLogReg', () => {
  it('learns a separable 1-D problem', () => {
    const X = [[0], [1], [2], [8], [9], [10]];
    const y = [0, 0, 0, 1, 1, 1];
    const m = fitLogReg(X, y, { l2: 0.001, epochs: 2000, lr: 0.5 });
    expect(predict(m, [0])).toBeLessThan(0.2);
    expect(predict(m, [10])).toBeGreaterThan(0.8);
  });
});

describe('splitOf', () => {
  it('is deterministic and roughly 40/35/25', () => {
    const counts = { train: 0, calib: 0, test: 0 };
    for (let i = 0; i < 4000; i++) counts[splitOf(`g-${i}`)]++;
    expect(splitOf('xsum-1')).toBe(splitOf('xsum-1'));
    expect(counts.train / 4000).toBeCloseTo(0.4, 1);
    expect(counts.calib / 4000).toBeCloseTo(0.35, 1);
    expect(counts.test / 4000).toBeCloseTo(0.25, 1);
  });
});
