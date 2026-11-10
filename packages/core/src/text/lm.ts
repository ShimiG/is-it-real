/**
 * Tier 1 text features: a small language model used as a PROBABILITY METER (ADR-0001).
 * The model is never prompted or asked for an opinion; we only read the probabilities it
 * assigns to each next token and compute statistics from them.
 *
 * Main statistic: the Fast-DetectGPT analytic criterion (Bao et al., ICLR 2024), i.e. the
 * conditional probability curvature with the same model for sampling and scoring:
 *
 *   d = (sum_t log p(x_t) - sum_t mu_t) / sqrt(sum_t var_t)
 *   mu_t  = E_{v ~ p_t}[log p_t(v)],  var_t = E_{v ~ p_t}[log p_t(v)^2] - mu_t^2
 *
 * Machine text tends to sit near the top of the model's probability surface (d large);
 * human text scores lower. Ported from `get_sampling_discrepancy_analytic` in
 * baoguangsheng/fast-detect-gpt (MIT) and parity-checked in eval/reference.
 */

/** Raw output of one model pass. Row t of `logits` is the prediction for token t + 1. */
export interface LmOutput {
  modelId: string;
  tokenIds: ArrayLike<number>;
  /** Row-major [tokenIds.length, vocabSize]. */
  logits: Float32Array;
  vocabSize: number;
}

/** Host-provided model runner (Node: packages/lm-node; browser: ONNX Runtime Web, Phase 2). */
export interface LanguageModel {
  id: string;
  /** Runs the model on the first `maxTokens` tokens of `text`. */
  run(text: string, maxTokens: number): Promise<LmOutput>;
}

export const LM_FEATURES = [
  'fdCriterion',
  'fdPerToken',
  'surprisalMean',
  'surprisalStd',
  'surprisalSkew',
  'surprisalKurt',
  'entropyMean',
  'deltaStd',
  'delta2Autocorr',
  'top1Rate',
  'logTokens',
] as const;
export type LmFeature = (typeof LM_FEATURES)[number];
export type LmFeatures = Record<LmFeature, number>;

/** Fewer scored tokens than this and the statistics are too noisy to use. */
export const MIN_LM_TOKENS = 50;

export function lmFeatures(out: LmOutput): LmFeatures | null {
  const { logits, vocabSize: V, tokenIds } = out;
  const n = tokenIds.length - 1; // tokens with a prediction
  if (n < MIN_LM_TOKENS || logits.length < (n + 1) * V) return null;

  const surprisal = new Float64Array(n);
  const exps = new Float64Array(V);
  let sumLl = 0;
  let sumMu = 0;
  let sumVar = 0;
  let top1 = 0;

  for (let t = 0; t < n; t++) {
    const base = t * V;
    let max = -Infinity;
    let argmax = 0;
    for (let v = 0; v < V; v++) {
      const l = logits[base + v]!;
      if (l > max) {
        max = l;
        argmax = v;
      }
    }
    let z = 0;
    for (let v = 0; v < V; v++) {
      const e = Math.exp(logits[base + v]! - max);
      exps[v] = e;
      z += e;
    }
    const logZ = Math.log(z) + max;
    let mu = 0;
    let m2 = 0;
    for (let v = 0; v < V; v++) {
      const p = exps[v]! / z;
      if (p === 0) continue;
      const lp = logits[base + v]! - logZ;
      mu += p * lp;
      m2 += p * lp * lp;
    }
    const target = tokenIds[t + 1]!;
    const ll = logits[base + target]! - logZ;
    sumLl += ll;
    sumMu += mu;
    sumVar += m2 - mu * mu;
    surprisal[t] = -ll;
    if (target === argmax) top1++;
  }

  const delta = diff(surprisal);
  const delta2 = diff(delta);
  const m = moments(surprisal);
  return {
    fdCriterion: (sumLl - sumMu) / Math.sqrt(sumVar),
    fdPerToken: (sumLl - sumMu) / n,
    surprisalMean: m.mean,
    surprisalStd: m.std,
    surprisalSkew: m.skew,
    surprisalKurt: m.kurt,
    entropyMean: -sumMu / n,
    deltaStd: moments(delta).std,
    delta2Autocorr: lag1Autocorr(delta2),
    top1Rate: top1 / n,
    logTokens: Math.log(n),
  };
}

function diff(x: Float64Array): Float64Array {
  const d = new Float64Array(Math.max(0, x.length - 1));
  for (let i = 0; i < d.length; i++) d[i] = x[i + 1]! - x[i]!;
  return d;
}

function moments(x: Float64Array) {
  const n = x.length;
  if (n === 0) return { mean: 0, std: 0, skew: 0, kurt: 0 };
  let mean = 0;
  for (const v of x) mean += v;
  mean /= n;
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  for (const v of x) {
    const d = v - mean;
    m2 += d * d;
    m3 += d * d * d;
    m4 += d * d * d * d;
  }
  m2 /= n;
  m3 /= n;
  m4 /= n;
  const std = Math.sqrt(m2);
  return {
    mean,
    std,
    skew: std === 0 ? 0 : m3 / (std * std * std),
    kurt: m2 === 0 ? 0 : m4 / (m2 * m2) - 3,
  };
}

function lag1Autocorr(x: Float64Array): number {
  const n = x.length;
  if (n < 3) return 0;
  let mean = 0;
  for (const v of x) mean += v;
  mean /= n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const d = x[i]! - mean;
    den += d * d;
    if (i + 1 < n) num += d * (x[i + 1]! - mean);
  }
  return den === 0 ? 0 : num / den;
}
