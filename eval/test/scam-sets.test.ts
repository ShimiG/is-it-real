import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SCAM_ENGINE_VERSION } from '@isitreal/core';
import { evaluateScam, loadScamJsonl } from '../src/scam.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'datasets', 'scam');

describe('scam rules meet the M1 targets', () => {
  it.each(['dev', 'test'])('%s set: recall >= 90%%, false positives < 5%%', async (set) => {
    const r = evaluateScam(
      set,
      SCAM_ENGINE_VERSION,
      await loadScamJsonl(join(dir, `${set}.jsonl`)),
    );
    expect(r.recall).toBeGreaterThanOrEqual(0.9);
    expect(r.falsePositiveRate).toBeLessThan(0.05);
  });
});
