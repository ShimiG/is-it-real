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

  it('says "not checked" when a check was asked to look and could not', () => {
    // Reported from real use: AI pictures in a drawn style showed "No clear signs", which
    // reads as "we looked and found nothing". Nothing had looked at the picture itself.
    const noLabel: DetectorResult = {
      status: 'assessed',
      signal: {
        detector: 'test.metadata@0',
        modality: 'image',
        kind: 'provenance',
        score: 0,
        reasons: [],
      },
    };
    const refused: DetectorResult = {
      status: 'not_assessed',
      detector: 'test.classifier@0',
      reason: 'not_a_photo',
    };
    expect(resolveOutcome('image', [noLabel, refused])).toMatchObject({
      outcome: 'not_assessed',
      reasons: ['not_a_photo'],
    });
    // With only the label check asked, nothing found is "no clear signs" as before.
    expect(resolveOutcome('image', [noLabel])).toMatchObject({
      outcome: 'no_clear_signs',
      reasons: [],
    });
    // A declaration still wins over everything.
    expect(resolveOutcome('image', [label(1), refused]).outcome).toBe('verified_ai');
  });

  it('keeps what the signature check found when a statistical check also ran', () => {
    const broken: DetectorResult = {
      status: 'assessed',
      signal: {
        detector: 'test.c2pa@0',
        modality: 'video',
        kind: 'provenance',
        score: 0,
        reasons: ['c2pa_invalid_signature'],
      },
    };
    const quiet = resolveOutcome('video', [broken, stat(0.2)]);
    expect(quiet.outcome).toBe('no_clear_signs');
    expect(quiet.reasons).toEqual(['c2pa_invalid_signature']);
    const flagged = resolveOutcome('video', [broken, stat(0.995)]);
    expect(flagged.outcome).toBe('likely_ai');
    expect(flagged.reasons).toEqual(['text_probability_curvature', 'c2pa_invalid_signature']);
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
