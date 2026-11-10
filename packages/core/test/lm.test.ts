import { describe, expect, it } from 'vitest';
import {
  MIN_LM_TOKENS,
  applyLogistic,
  checkTextDeep,
  detectTextDeep,
  lmFeatures,
  type LanguageModel,
  type LmOutput,
  type TextEnsembleModel,
} from '../src/index.js';

/** Builds logits for a tiny vocabulary: every row is the same distribution `probs`. */
function constantModel(probs: number[], tokenIds: number[]): LmOutput {
  const V = probs.length;
  const logits = new Float32Array(tokenIds.length * V);
  for (let t = 0; t < tokenIds.length; t++)
    probs.forEach((p, v) => (logits[t * V + v] = Math.log(p)));
  return { modelId: 'fake', tokenIds, logits, vocabSize: V };
}

describe('lmFeatures', () => {
  const probs = [0.7, 0.2, 0.1];
  const mu = probs.reduce((a, p) => a + p * Math.log(p), 0);
  const variance = probs.reduce((a, p) => a + p * Math.log(p) ** 2, 0) - mu * mu;

  it('matches the Fast-DetectGPT formula computed by hand', () => {
    const n = 60;
    const ids = [0, ...Array.from({ length: n }, () => 0)]; // always the most likely token
    const f = lmFeatures(constantModel(probs, ids))!;
    const expected = (n * Math.log(0.7) - n * mu) / Math.sqrt(n * variance);
    expect(f.fdCriterion).toBeCloseTo(expected, 4);
    expect(f.fdCriterion).toBeGreaterThan(0); // likelier than the model expects: machine-like
    expect(f.top1Rate).toBe(1);
    expect(f.entropyMean).toBeCloseTo(-mu, 5);
    expect(f.surprisalStd).toBeCloseTo(0, 5);
  });

  it('gives a negative criterion for text the model finds surprising', () => {
    const ids = [0, ...Array.from({ length: 60 }, () => 2)]; // always the least likely token
    expect(lmFeatures(constantModel(probs, ids))!.fdCriterion).toBeLessThan(0);
  });

  it('refuses very short inputs', () => {
    const ids = Array.from({ length: MIN_LM_TOKENS }, () => 0); // one fewer prediction than needed
    expect(lmFeatures(constantModel(probs, ids))).toBeNull();
  });
});

describe('applyLogistic', () => {
  it('standardises features and reports contributions', () => {
    const r = applyLogistic(
      { features: ['a', 'b'], mean: [1, 0], std: [2, 1], weights: [1, -1], bias: 0.5 },
      [3, 1],
    );
    expect(r.contributions).toEqual({ a: 1, b: -1 });
    expect(r.raw).toBeCloseTo(1 / (1 + Math.exp(-0.5)));
  });
});

describe('detectTextDeep', () => {
  const LONG =
    'The quick brown fox jumps over the lazy dog and then it is going to rest by the river for a while. '.repeat(
      8,
    );
  const fakeLm = (id: string): LanguageModel => ({
    id,
    run: async (_text, maxTokens) =>
      constantModel(
        [0.7, 0.2, 0.1],
        Array.from({ length: Math.min(maxTokens, 120) }, () => 0),
      ),
  });
  const model: TextEnsembleModel = {
    id: 'test.ensemble',
    lmId: 'fake',
    maxTokens: 320,
    minWords: 110,
    features: ['lm.fdCriterion', 't0.sentLenCV'],
    mean: [0, 0],
    std: [1, 1],
    weights: [1, 0],
    bias: 0,
    calibration: [0.1, 0.2, 0.3, 0.4],
    trainedOn: 'unit test',
  };

  it('scores long English text and explains with the probability reason', async () => {
    const r = await detectTextDeep(LONG, fakeLm('fake'), model);
    expect(r.status).toBe('assessed');
    if (r.status === 'assessed') {
      expect(r.signal.score).toBeCloseTo(0.8); // above all 4 calibration scores: 1 - 1/5
      expect(r.signal.reasons).toEqual(['text_probability_curvature']);
    }
  });

  it('refuses short text without running the model', async () => {
    let called = false;
    const lm: LanguageModel = {
      id: 'fake',
      run: async () => ((called = true), constantModel([1], [])),
    };
    expect(await detectTextDeep('Too short.', lm, model)).toMatchObject({
      status: 'not_assessed',
      reason: 'too_short',
    });
    expect(called).toBe(false);
  });

  it('rejects a language model the weights were not trained with', async () => {
    await expect(detectTextDeep(LONG, fakeLm('other-model'), model)).rejects.toThrow(
      /trained with/,
    );
  });

  it('checkTextDeep still reports scam risk first', async () => {
    const lm: LanguageModel = {
      id: 'gpt2-124m-onnx-zoo-10',
      run: async () => constantModel([1], []),
    };
    const r = await checkTextDeep(
      { text: 'Pay the fine with Google Play gift cards today. Do not tell anyone.' },
      lm,
    );
    expect(r.scamRisk).toBe('high');
    expect(r.items[0]!.outcome).toBe('not_assessed');
  });
});
