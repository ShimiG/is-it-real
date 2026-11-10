import { describe, expect, it } from 'vitest';
import { OUTCOMES, resolveOutcome, type DetectorResult, type Signal } from '../src/index.js';

const stat = (score: number): DetectorResult => ({
  status: 'assessed',
  signal: {
    detector: 'test.stat@0',
    modality: 'text',
    kind: 'statistical',
    score,
    reasons: ['text_probability_curvature'],
  },
});

const label = (score: number): DetectorResult => ({
  status: 'assessed',
  signal: {
    detector: 'test.label@0',
    modality: 'image',
    kind: 'platform_label',
    score,
    reasons: ['platform_label_ai'],
  } satisfies Signal,
});

describe('resolveOutcome', () => {
  it('never offers a "human" outcome', () => {
    expect(OUTCOMES).not.toContain('human');
    expect(OUTCOMES).not.toContain('real');
  });

  it('declared AI provenance overrides low statistical scores', () => {
    const v = resolveOutcome('image', [stat(0.01), label(1)]);
    expect(v.outcome).toBe('verified_ai');
    expect(v.alert).toBe(true);
    expect(v.reasons).toEqual(['platform_label_ai']);
  });

  it('flags likely_ai at or above the conformal threshold', () => {
    const v = resolveOutcome('text', [stat(0.995)], { likelyAi: 0.99, alert: 0.999 });
    expect(v.outcome).toBe('likely_ai');
    expect(v.alert).toBe(false);
  });

  it('only alerts above the stricter alert threshold', () => {
    expect(resolveOutcome('text', [stat(0.9995)]).alert).toBe(true);
  });

  it('below threshold is "no clear signs" with no reasons shown', () => {
    const v = resolveOutcome('text', [stat(0.4)]);
    expect(v.outcome).toBe('no_clear_signs');
    expect(v.reasons).toEqual([]);
  });

  it('returns not_assessed with the refusal reason when nothing could judge', () => {
    const v = resolveOutcome('text', [
      { status: 'not_assessed', detector: 'test.stat@0', reason: 'too_short' },
    ]);
    expect(v).toMatchObject({ outcome: 'not_assessed', confidence: null, reasons: ['too_short'] });
  });

  it('a checked label that does not declare AI gives "no clear signs", never verified_ai', () => {
    expect(resolveOutcome('image', [label(0)])).toMatchObject({
      outcome: 'no_clear_signs',
      confidence: null,
    });
  });
});
