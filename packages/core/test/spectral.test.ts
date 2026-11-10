import { describe, expect, it } from 'vitest';
import {
  SPECTRAL_FEATURES,
  SPECTRAL_SIZE,
  centerLuminance,
  fft,
  powerSpectrum2d,
  spectralFeatures,
  type Pixels,
} from '../src/index.js';

/** Deterministic pseudo-random numbers in [0, 1). */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}

/** A grey image built from a function of (x, y), as RGBA pixels. */
function image(width: number, height: number, f: (x: number, y: number) => number): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const v = f(x, y);
      data.set([v, v, v, 255], (y * width + x) * 4);
    }
  return { width, height, data };
}

describe('fft', () => {
  it('turns an impulse into a flat spectrum', () => {
    const re = new Float64Array(8);
    const im = new Float64Array(8);
    re[0] = 1;
    fft(re, im);
    expect([...re].every((v) => Math.abs(v - 1) < 1e-12)).toBe(true);
    expect([...im].every((v) => Math.abs(v) < 1e-12)).toBe(true);
  });

  it('puts a cosine at its own frequency', () => {
    const n = 32;
    const re = Float64Array.from({ length: n }, (_, i) => Math.cos((2 * Math.PI * 5 * i) / n));
    const im = new Float64Array(n);
    fft(re, im);
    const mag = Array.from(re, (r, i) => Math.hypot(r, im[i]!));
    expect(mag[5]).toBeCloseTo(n / 2, 6);
    expect(mag[n - 5]).toBeCloseTo(n / 2, 6);
    expect(mag[4]).toBeLessThan(1e-9);
  });

  it('rejects lengths that are not a power of two', () => {
    expect(() => fft(new Float64Array(6), new Float64Array(6))).toThrow(RangeError);
  });

  it('2D power spectrum keeps the total energy (Parseval)', () => {
    const n = 16;
    const r = rng(1);
    const img = Float64Array.from({ length: n * n }, () => r() - 0.5);
    const energy = img.reduce((a, v) => a + v * v, 0);
    const spectrum = powerSpectrum2d(img, n).reduce((a, v) => a + v, 0) / (n * n);
    expect(spectrum).toBeCloseTo(energy, 8);
  });
});

describe('spectralFeatures', () => {
  const r = rng(7);
  const noise = Float64Array.from({ length: 512 * 512 }, () => r());
  // A smooth scene (low frequencies) plus mild sensor-like noise.
  const natural = (x: number, y: number) =>
    128 + 60 * Math.sin(x / 40) * Math.cos(y / 55) + 12 * (noise[y * 512 + x]! - 0.5);

  it('returns every feature as a finite number', () => {
    const f = spectralFeatures(image(512, 512, natural))!;
    for (const k of SPECTRAL_FEATURES) expect(Number.isFinite(f[k]), k).toBe(true);
  });

  it('refuses images smaller than the analysis window', () => {
    expect(spectralFeatures(image(200, 300, natural))).toBeNull();
    expect(centerLuminance(image(SPECTRAL_SIZE, SPECTRAL_SIZE, natural))).not.toBeNull();
  });

  it('sees a periodic pattern (like an upsampling trace) as a strong isolated peak', () => {
    const base = spectralFeatures(image(512, 512, natural))!;
    const withGrid = spectralFeatures(
      image(
        512,
        512,
        (x, y) => natural(x, y) + 6 * Math.cos((2 * Math.PI * (45 * x + 38 * y)) / 128),
      ),
    )!;
    expect(withGrid.peakiness).toBeGreaterThan(base.peakiness + 2);
  });

  it('measures less fine detail in a blurred image', () => {
    const sharp = spectralFeatures(image(512, 512, natural))!;
    const blurred = spectralFeatures(
      image(512, 512, (x, y) => 128 + 60 * Math.sin(x / 40) * Math.cos(y / 55)),
    )!;
    expect(blurred.residualStd).toBeLessThan(sharp.residualStd / 3);
  });

  it('sees an 8-pixel block grid (JPEG-like)', () => {
    const blocky = spectralFeatures(
      image(512, 512, (x, y) => natural(x, y) + (x % 8 === 0 ? 5 : 0) + (y % 8 === 0 ? 5 : 0)),
    )!;
    const plain = spectralFeatures(image(512, 512, natural))!;
    expect(blocky.gridPeak8).toBeGreaterThan(plain.gridPeak8 + 1);
  });
});
