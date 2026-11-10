/** A logistic model over standardised features, stored as plain JSON (trained in eval/). */
export interface LogisticModel {
  features: string[];
  mean: number[];
  std: number[];
  weights: number[];
  bias: number;
}

export interface LogisticResult {
  /** Uncalibrated probability-like score in (0, 1). */
  raw: number;
  /** Per-feature contribution to the logit, for explanations. */
  contributions: Record<string, number>;
}

export function applyLogistic(m: LogisticModel, x: ArrayLike<number>): LogisticResult {
  let z = m.bias;
  const contributions: Record<string, number> = {};
  for (let i = 0; i < m.features.length; i++) {
    const c = m.weights[i]! * ((x[i]! - m.mean[i]!) / (m.std[i]! || 1));
    contributions[m.features[i]!] = c;
    z += c;
  }
  return { raw: 1 / (1 + Math.exp(-z)), contributions };
}
