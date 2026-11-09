import { describe, expect, it } from 'vitest';
import { auroc, conformalThreshold, fprBySubgroup, rate, type Scored } from '../src/metrics.js';

const s = (truth: 'ai' | 'human', score: number, subgroup = 'g'): Scored => ({
  truth,
  score,
  subgroup,
});

describe('auroc', () => {
  it('is 1 for perfect separation and 0 for inverted', () => {
    expect(auroc([s('ai', 0.9), s('ai', 0.8), s('human', 0.1), s('human', 0.2)])).toBe(1);
    expect(auroc([s('ai', 0.1), s('human', 0.9)])).toBe(0);
  });

  it('counts ties as one half', () => {
    expect(auroc([s('ai', 0.5), s('human', 0.5)])).toBe(0.5);
  });

  it('matches a hand-computed value', () => {
    // pairs (ai > human): 0.8>0.3 0.8>0.6 0.4>0.3 => 3 of 4
    expect(auroc([s('ai', 0.8), s('ai', 0.4), s('human', 0.3), s('human', 0.6)])).toBe(0.75);
  });

  it('is NaN when a class is missing', () => {
    expect(auroc([s('ai', 0.5)])).toBeNaN();
  });
});

describe('conformalThreshold', () => {
  const human = Array.from({ length: 99 }, (_, i) => (i + 1) / 100); // 0.01 .. 0.99

  it('picks the ceil((n+1)(1-alpha))-th smallest score', () => {
    // n=99, alpha=0.1 -> k = ceil(100*0.9) = 90 -> 0.90
    expect(conformalThreshold(human, 0.1)).toBeCloseTo(0.9);
  });

  it('keeps in-sample FPR at or below alpha', () => {
    const t = conformalThreshold(human, 0.05);
    expect(
      rate(
        human.map((x) => s('human', x)),
        t,
      ),
    ).toBeLessThanOrEqual(0.05);
  });

  it('refuses (infinite threshold) when there are too few human items', () => {
    expect(conformalThreshold([0.1, 0.2, 0.3], 0.01)).toBe(Number.POSITIVE_INFINITY);
  });

  it('rejects an invalid alpha', () => {
    expect(() => conformalThreshold(human, 0)).toThrow(RangeError);
  });
});

describe('fprBySubgroup', () => {
  it('reports per-group FPR for human items only', () => {
    const items = [
      s('human', 0.9, 'b'),
      s('human', 0.1, 'b'),
      s('human', 0.1, 'a'),
      s('ai', 0.99, 'a'),
    ];
    expect(fprBySubgroup(items, 0.5)).toEqual([
      { subgroup: 'a', n: 1, falsePositiveRate: 0 },
      { subgroup: 'b', n: 2, falsePositiveRate: 0.5 },
    ]);
  });
});
