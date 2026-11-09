import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadJsonl } from '../src/dataset.js';
import { randomBaseline } from '../src/detectors.js';
import { evaluate } from '../src/run.js';

const toy = join(dirname(fileURLToPath(import.meta.url)), '..', 'datasets', 'toy', 'text.jsonl');

describe('evaluate on the toy set', () => {
  it('runs end to end and abstains on short items', async () => {
    const items = await loadJsonl(toy);
    const r = evaluate(randomBaseline, 'toy', items, 0.1);
    expect(r.n).toBe(16);
    expect(r.notAssessedReasons).toEqual({ too_short: 2 });
    expect(r.auroc).toBeGreaterThanOrEqual(0);
    expect(r.auroc).toBeLessThanOrEqual(1);
    expect(r.falsePositiveRate).toBeLessThanOrEqual(0.1);
  });

  it('warns and flags nothing when alpha is too strict for the sample size', async () => {
    const items = await loadJsonl(toy);
    const r = evaluate(randomBaseline, 'toy', items, 0.01);
    expect(r.threshold).toBe(Number.POSITIVE_INFINITY);
    expect(r.detectionRate).toBe(0);
    expect(r.warnings.join(' ')).toMatch(/too few/);
  });
});
