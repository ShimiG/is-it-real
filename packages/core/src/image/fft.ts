/** Minimal radix-2 FFT (pure, no dependencies) for the image frequency analysis. */

/** In-place complex FFT. `re` and `im` must have a power-of-two length. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (n === 0 || (n & (n - 1)) !== 0 || im.length !== n)
    throw new RangeError('FFT length must be a power of two');
  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]!;
      re[i] = re[j]!;
      re[j] = tr;
      const ti = im[i]!;
      im[i] = im[j]!;
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let start = 0; start < n; start += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len >> 1; k++) {
        const a = start + k;
        const b = a + (len >> 1);
        const xr = re[b]! * cr - im[b]! * ci;
        const xi = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - xr;
        im[b] = im[a]! - xi;
        re[a] = re[a]! + xr;
        im[a] = im[a]! + xi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/**
 * Power spectrum |F|^2 of a square n x n real image (row-major), DC at index 0.
 * Returns a new Float64Array of n * n values.
 */
export function powerSpectrum2d(image: Float64Array, n: number): Float64Array {
  if (image.length !== n * n) throw new RangeError('image must be n x n');
  const re = Float64Array.from(image);
  const im = new Float64Array(n * n);
  const rowRe = new Float64Array(n);
  const rowIm = new Float64Array(n);
  for (let y = 0; y < n; y++) {
    rowRe.set(re.subarray(y * n, (y + 1) * n));
    rowIm.fill(0);
    fft(rowRe, rowIm);
    re.set(rowRe, y * n);
    im.set(rowIm, y * n);
  }
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      rowRe[y] = re[y * n + x]!;
      rowIm[y] = im[y * n + x]!;
    }
    fft(rowRe, rowIm);
    for (let y = 0; y < n; y++) {
      re[y * n + x] = rowRe[y]!;
      im[y * n + x] = rowIm[y]!;
    }
  }
  const power = new Float64Array(n * n);
  for (let i = 0; i < power.length; i++) power[i] = re[i]! * re[i]! + im[i]! * im[i]!;
  return power;
}
