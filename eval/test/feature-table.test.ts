import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  LM_FEATURES,
  TEXT_ENSEMBLE_MODEL,
  TEXT_FEATURES,
  TEXT_STATS_MODEL,
  applyLogistic,
  conformalScore,
} from '@isitreal/core';
import { FEATURES_FILE, loadFeatureRows } from '../src/features.js';
import { usable, vector } from '../src/text-models.js';

describe.skipIf(!existsSync(FEATURES_FILE))('feature table', () => {
  const rows = loadFeatureRows();

  it('has the expected shape', () => {
    expect(rows.length).toBeGreaterThan(6000);
    for (const r of rows.slice(0, 50)) {
      expect(r.t0).toHaveLength(TEXT_FEATURES.length);
      if (r.lm !== null) expect(r.lm).toHaveLength(LM_FEATURES.length);
    }
  });

  it('keeps the bias and external sets out of training and calibration', () => {
    const testOnly = rows.filter(
      (r) => r.dataset === 'liang' || r.dataset === 'fdgpt' || r.subgroup === 'humanizer-rewritten',
    );
    expect(testOnly.length).toBeGreaterThan(1000);
    expect(testOnly.every((r) => r.split === 'test')).toBe(true);
  });

  it('never splits a prompt group across train, calibration and test', () => {
    const seen = new Map<string, string>();
    for (const r of rows) {
      const prev = seen.get(r.group);
      if (prev !== undefined) expect(prev).toBe(r.split);
      seen.set(r.group, r.split);
    }
  });

  it('shipped models are the ones trained from this table and keep false alarms low on calibration-like text', () => {
    expect(TEXT_STATS_MODEL.id).toBe('text.stats@0.2.0');
    expect(TEXT_ENSEMBLE_MODEL.id).toBe('text.ensemble@0.2.0');
    expect(TEXT_ENSEMBLE_MODEL.calibration.length).toBeGreaterThan(500);
    const spec = { id: '', description: '', trained: true, features: TEXT_ENSEMBLE_MODEL.features };
    // Human test rows from the same kinds of text the model was calibrated on.
    const humans = rows.filter(
      (r) => usable(r) && r.split === 'test' && r.truth === 'human' && r.dataset === 'ghostbuster',
    );
    const flagged = humans.filter(
      (r) =>
        conformalScore(
          applyLogistic(TEXT_ENSEMBLE_MODEL, vector(r, spec)).raw,
          TEXT_ENSEMBLE_MODEL.calibration,
        ) >= 0.99,
    );
    expect(humans.length).toBeGreaterThan(500);
    expect(flagged.length / humans.length).toBeLessThan(0.03);
  });
});
