import { powerSpectrum2d } from './fft.js';

/**
 * Frequency-domain features of an image (PLAN 5.3, step 4). Image generators leave traces in the
 * high frequencies: periodic peaks from upsampling layers and an unusual fall-off of energy.
 *
 * STATUS: feature extraction only. These numbers are NOT used in any verdict yet, because no
 * model has been trained or calibrated on them (that needs AI-image data; see docs/eval/m3-progress.md).
 *
 * Method: take the central 256 x 256 pixels at native resolution (never resize: resizing destroys
 * the traces), convert to luminance, subtract a 3 x 3 local mean to keep only fine detail, apply
 * a Hann window, and take the 2D power spectrum.
 */

/** Decoded pixels, as produced by a host decoder (sharp in Node, canvas in the browser). */
export interface Pixels {
  width: number;
  height: number;
  /** RGBA, 8 bits per channel, row-major. */
  data: Uint8Array | Uint8ClampedArray;
}

export const SPECTRAL_SIZE = 256;
export const RADIAL_BINS = 16;

export const SPECTRAL_FEATURES = [
  'radial0',
  'radial1',
  'radial2',
  'radial3',
  'radial4',
  'radial5',
  'radial6',
  'radial7',
  'radial8',
  'radial9',
  'radial10',
  'radial11',
  'radial12',
  'radial13',
  'radial14',
  'radial15',
  'slope',
  'highFreqShare',
  'peakiness',
  'gridPeak8',
  'axisShare',
  'residualStd',
] as const;
export type SpectralFeatures = Record<(typeof SPECTRAL_FEATURES)[number], number>;

/** Central n x n luminance crop (0..255), or null when the image is smaller than n in either direction. */
export function centerLuminance(pixels: Pixels, n = SPECTRAL_SIZE): Float64Array | null {
  const { width, height, data } = pixels;
  if (width < n || height < n || data.length < width * height * 4) return null;
  const x0 = (width - n) >> 1;
  const y0 = (height - n) >> 1;
  const out = new Float64Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = ((y0 + y) * width + (x0 + x)) * 4;
      out[y * n + x] = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
    }
  }
  return out;
}

/** Fine detail only: each pixel minus the mean of its 3 x 3 neighbourhood (edges clamp). */
export function highPassResidual(image: Float64Array, n: number): Float64Array {
  const out = new Float64Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = Math.min(n - 1, Math.max(0, y + dy));
        for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.min(n - 1, Math.max(0, x + dx));
          sum += image[yy * n + xx]!;
        }
      }
      out[y * n + x] = image[y * n + x]! - sum / 9;
    }
  }
  return out;
}

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export function spectralFeatures(pixels: Pixels): SpectralFeatures | null {
  const n = SPECTRAL_SIZE;
  const lum = centerLuminance(pixels, n);
  if (lum === null) return null;
  const residual = highPassResidual(lum, n);

  let mean = 0;
  for (const v of residual) mean += v;
  mean /= residual.length;
  let variance = 0;
  for (let i = 0; i < residual.length; i++) {
    const y = (i / n) | 0;
    const x = i % n;
    const centered = residual[i]! - mean;
    variance += centered * centered;
    const w =
      0.25 *
      (1 - Math.cos((2 * Math.PI * x) / (n - 1))) *
      (1 - Math.cos((2 * Math.PI * y) / (n - 1)));
    residual[i] = centered * w;
  }
  const residualStd = Math.sqrt(variance / residual.length);

  const power = powerSpectrum2d(residual, n);
  const half = n >> 1;
  const logP = (fx: number, fy: number) =>
    Math.log(power[((fy + n) % n) * n + ((fx + n) % n)]! + 1e-12);

  // Radial profile over frequencies 1 .. n/2 (the spectrum of a real image is symmetric,
  // so the half-plane fy >= 0 is enough).
  const binSum = new Float64Array(RADIAL_BINS);
  const binCount = new Float64Array(RADIAL_BINS);
  const logR: number[] = [];
  const logV: number[] = [];
  let total = 0;
  let high = 0;
  let axis = 0;
  for (let fy = 0; fy <= half; fy++) {
    for (let fx = -half + 1; fx <= half; fx++) {
      const r = Math.hypot(fx, fy);
      if (r < 1 || r > half) continue;
      const p = power[((fy + n) % n) * n + ((fx + n) % n)]!;
      total += p;
      if (r > half / 2) high += p;
      if (fx === 0 || fy === 0) axis += p;
      const bin = Math.min(RADIAL_BINS - 1, Math.floor(((r - 1) / (half - 1)) * RADIAL_BINS));
      const lp = Math.log(p + 1e-12);
      binSum[bin]! += lp;
      binCount[bin]! += 1;
      logR.push(Math.log(r));
      logV.push(lp);
    }
  }
  const radial = Array.from(binSum, (s, i) => (binCount[i]! > 0 ? s / binCount[i]! : 0));
  const radialMean = radial.reduce((a, b) => a + b, 0) / RADIAL_BINS;

  // Slope of log power against log frequency (natural photos fall off steadily).
  const mr = logR.reduce((a, b) => a + b, 0) / logR.length;
  const mv = logV.reduce((a, b) => a + b, 0) / logV.length;
  let cov = 0;
  let varR = 0;
  for (let i = 0; i < logR.length; i++) {
    cov += (logR[i]! - mr) * (logV[i]! - mv);
    varR += (logR[i]! - mr) ** 2;
  }

  // Peakiness: the strongest isolated peak in the upper half of the frequency range, measured
  // against the median of its 5 x 5 neighbourhood. Periodic upsampling traces show up here.
  let peakiness = 0;
  for (let fy = 0; fy <= half - 3; fy++) {
    for (let fx = -half + 3; fx <= half - 3; fx++) {
      const r = Math.hypot(fx, fy);
      if (r < half / 2 || r > half - 3 || fx === 0 || fy === 0) continue;
      const neighbours: number[] = [];
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++)
          if (dx !== 0 || dy !== 0) neighbours.push(logP(fx + dx, fy + dy));
      peakiness = Math.max(peakiness, logP(fx, fy) - median(neighbours));
    }
  }

  // Energy at multiples of n/8 on the axes: the 8 x 8 block grid of JPEG (and of some decoders).
  const step = n / 8;
  const gridPoints: number[] = [];
  const offGrid: number[] = [];
  for (let k = 1; k < half; k++) {
    const v = (logP(k, 0) + logP(0, k)) / 2;
    (k % step === 0 ? gridPoints : offGrid).push(v);
  }

  const features = {} as SpectralFeatures;
  radial.forEach((v, i) => (features[SPECTRAL_FEATURES[i]!] = v - radialMean));
  features.slope = varR === 0 ? 0 : cov / varR;
  features.highFreqShare = total === 0 ? 0 : high / total;
  features.peakiness = peakiness;
  features.gridPeak8 = median(gridPoints) - median(offGrid);
  features.axisShare = total === 0 ? 0 : axis / total;
  features.residualStd = residualStd;
  return features;
}
