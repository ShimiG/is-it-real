import { describe, expect, it } from 'vitest';
import {
  OUTCOME_TEXT,
  REASON_CODES,
  REASON_TEXT,
  SCAM_TEXT,
  SignalSchema,
  VerdictSchema,
} from '../src/index.js';

describe('schemas', () => {
  it('reject a "human" outcome at runtime', () => {
    const r = VerdictSchema.safeParse({
      modality: 'text',
      outcome: 'human',
      confidence: 0.9,
      alert: false,
      signals: [],
      reasons: [],
    });
    expect(r.success).toBe(false);
  });

  it('reject scores outside [0, 1]', () => {
    const r = SignalSchema.safeParse({
      detector: 'x',
      modality: 'text',
      kind: 'statistical',
      score: 1.2,
      reasons: [],
    });
    expect(r.success).toBe(false);
  });
});

describe('user-facing text', () => {
  it('has a sentence for every reason code', () => {
    for (const code of REASON_CODES) expect(REASON_TEXT[code]).toBeTruthy();
  });

  it('never claims content is human, real or safe', () => {
    const all = [
      ...Object.values(OUTCOME_TEXT).flatMap((t) => [t.title, t.body]),
      ...Object.values(SCAM_TEXT),
      ...Object.values(REASON_TEXT),
    ].join('\n');
    expect(all).not.toMatch(/\b(is|looks|appears) (human|real|genuine|authentic|safe)\b/i);
    expect(all).not.toMatch(/\bwritten by a (human|person)\b/i);
    expect(all).not.toMatch(/\d+\s?%/); // no bare percentages
  });
});
