import { describe, expect, it } from 'vitest';
import {
  ENGINE_VERSION,
  TEXT_STATS_MODEL,
  checkText,
  conformalScore,
  detectTextStats,
  isLikelyEnglish,
  mattr,
  splitSentences,
  textFeatures,
} from '../src/index.js';

const LONG_HUMAN = `It was a cold morning when the ferry finally left Brindisi, three hours late. Nobody explained why. The captain, a stout man with a cigarette he never lit, waved at the dock workers as if they'd done him a personal favour. My sister slept on the bench beside me. I watched the gulls. "Are we there?" she asked, twice, before we'd even cleared the harbour wall. I told her no, and then I told her the story Dad used to tell us about the fisherman who sold his boat for a donkey, which made no sense then and makes less sense now. She laughed anyway. By noon the sea had turned the colour of old pewter and the café on deck had run out of everything except lemon biscuits and warm beer. We bought both. Somewhere past Corfu a man in a yellow raincoat started singing, badly, and nobody stopped him. I think about that trip more often than I'd like to admit.`;

describe('text helpers', () => {
  it('splits sentences without breaking prices', () => {
    expect(splitSentences('It costs $1.99 today. Call now! Thanks.')).toEqual([
      'It costs $1.99 today.',
      'Call now!',
      'Thanks.',
    ]);
  });

  it('computes MATTR between 0 and 1', () => {
    expect(mattr(['a', 'a', 'a', 'a'])).toBe(0.25);
    expect(mattr(['a', 'b', 'c'])).toBe(1);
  });

  it('computes every feature as a finite number', () => {
    const f = textFeatures(LONG_HUMAN);
    for (const v of Object.values(f)) expect(Number.isFinite(v)).toBe(true);
    expect(f.sentLenCV).toBeGreaterThan(0.3); // human rhythm varies
  });

  it('detects English and rejects other languages', () => {
    expect(isLikelyEnglish(LONG_HUMAN)).toBe(true);
    expect(
      isLikelyEnglish(
        'El perro corre por el parque y la niña lo sigue con una pelota roja todos los días.',
      ),
    ).toBe(false);
    expect(isLikelyEnglish('שלום לכולם, היום נלך לים ונחזור בערב עם הילדים והכלב שלנו.')).toBe(
      false,
    );
  });
});

describe('conformalScore', () => {
  const calib = [0.1, 0.2, 0.3, 0.4];
  it('maps a raw score to 1 - p', () => {
    expect(conformalScore(0.5, calib)).toBeCloseTo(1 - 1 / 5); // above all: p = 1/(n+1)
    expect(conformalScore(0.05, calib)).toBe(0); // below all: p = 1
    expect(conformalScore(0.3, calib)).toBeCloseTo(1 - 3 / 5); // ties count as "at least"
  });

  it('cannot reach 0.99 with fewer than 99 calibration items', () => {
    expect(
      conformalScore(
        1,
        Array.from({ length: 50 }, (_, i) => i / 100),
      ),
    ).toBeLessThan(0.99);
  });
});

describe('detectTextStats', () => {
  it('ships a trained model with enough calibration data for alpha = 1%', () => {
    expect(TEXT_STATS_MODEL.id).not.toContain('untrained');
    expect(TEXT_STATS_MODEL.calibration.length).toBeGreaterThanOrEqual(99);
  });

  it('refuses short and non-English text', () => {
    expect(detectTextStats('Too short to judge.')).toMatchObject({
      status: 'not_assessed',
      reason: 'too_short',
    });
    const spanish = 'El perro corre por el parque y la niña lo sigue. '.repeat(15);
    expect(detectTextStats(spanish)).toMatchObject({
      status: 'not_assessed',
      reason: 'unsupported_language',
    });
  });

  it('returns a statistical signal in [0, 1] for long English text', () => {
    const r = detectTextStats(LONG_HUMAN);
    expect(r.status).toBe('assessed');
    if (r.status === 'assessed') {
      expect(r.signal.score).toBeGreaterThanOrEqual(0);
      expect(r.signal.score).toBeLessThan(1);
      expect(r.signal.reasons.length).toBeGreaterThan(0);
    }
  });
});

describe('checkText', () => {
  it('puts scam risk first and never says human', () => {
    const r = checkText({
      text: 'Buy Google Play gift cards and send me the codes on the back. Do not tell anyone.',
    });
    expect(r.scamRisk).toBe('high');
    expect(r.items[0]!.outcome).toBe('not_assessed');
    expect(r.engine).toBe(ENGINE_VERSION);
  });
});
