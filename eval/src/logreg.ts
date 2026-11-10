/** Small L2-regularised logistic regression (batch gradient descent). Enough for ~20 features. */
export interface LogReg {
  mean: number[];
  std: number[];
  weights: number[];
  bias: number;
}

export function standardize(X: readonly number[][]): { mean: number[]; std: number[] } {
  const d = X[0]?.length ?? 0;
  const mean = Array.from({ length: d }, (_, j) => X.reduce((a, x) => a + x[j]!, 0) / X.length);
  const std = Array.from({ length: d }, (_, j) => {
    const v = X.reduce((a, x) => a + (x[j]! - mean[j]!) ** 2, 0) / X.length;
    return Math.sqrt(v) || 1;
  });
  return { mean, std };
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

export function fitLogReg(
  X: readonly number[][],
  y: readonly number[],
  {
    l2 = 0.1,
    lr = 0.1,
    epochs = 3000,
    weights,
  }: { l2?: number; lr?: number; epochs?: number; weights?: readonly number[] } = {},
): LogReg {
  const { mean, std } = standardize(X);
  const Z = X.map((x) => x.map((v, j) => (v - mean[j]!) / std[j]!));
  const d = mean.length;
  const w = new Array<number>(d).fill(0);
  let b = 0;
  const n = Z.length;
  const sw = weights ?? new Array<number>(n).fill(1);
  const total = sw.reduce((a, v) => a + v, 0);
  for (let e = 0; e < epochs; e++) {
    const gw = new Array<number>(d).fill(0);
    let gb = 0;
    for (let i = 0; i < n; i++) {
      const zi = Z[i]!;
      const p = sigmoid(b + zi.reduce((a, v, j) => a + v * w[j]!, 0));
      const err = (p - y[i]!) * sw[i]!;
      for (let j = 0; j < d; j++) gw[j]! += err * zi[j]!;
      gb += err;
    }
    for (let j = 0; j < d; j++) w[j]! -= lr * (gw[j]! / total + l2 * w[j]!);
    b -= lr * (gb / total);
  }
  return { mean, std, weights: w, bias: b };
}

export function predict(m: LogReg, x: readonly number[]): number {
  return sigmoid(
    m.bias + x.reduce((a, v, j) => a + m.weights[j]! * ((v - m.mean[j]!) / m.std[j]!), 0),
  );
}
