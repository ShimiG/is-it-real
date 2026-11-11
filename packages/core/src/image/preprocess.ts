import type { Pixels } from './spectral.js';

/**
 * Image preprocessing for the image classifiers, as a pure-TypeScript port of what the
 * evaluation does in Python with Pillow, so every host (Node, browser) feeds a model exactly the
 * same numbers:
 *
 *   1. RGB (alpha dropped, like Pillow's convert("RGB") on RGBA)
 *   2. resize so the SHORT edge is `resizeShortEdge` (long edge = floor(short * long / short)),
 *      bicubic with antialiasing: a port of Pillow's Resample.c (8-bit, fixed point, horizontal
 *      pass then vertical pass, 8-bit intermediate)
 *   3. centre crop to `cropSize` (top/left = floor((size - crop) / 2))
 *   4. scale to [0, 1], normalise with the model's mean/std, channels first (CHW, float32)
 *
 * Parity with Pillow is checked in eval/reference (image_parity.py).
 */

export interface PreprocessSpec {
  resizeShortEdge: number;
  cropSize: number;
  mean: [number, number, number];
  std: [number, number, number];
}

const PRECISION_BITS = 32 - 8 - 2;
const SCALE = 2 ** PRECISION_BITS;
const HALF = 2 ** (PRECISION_BITS - 1);

function bicubic(x: number): number {
  const a = -0.5;
  const ax = Math.abs(x);
  if (ax < 1) return ((a + 2) * ax - (a + 3)) * ax * ax + 1;
  if (ax < 2) return (((ax - 5) * ax + 8) * ax - 4) * a;
  return 0;
}

/** Pillow's precompute_coeffs + normalize_coeffs_8bpc for one axis. */
function coefficients(
  inSize: number,
  outSize: number,
): { bounds: Int32Array; kk: Int32Array; ksize: number } {
  const scale = inSize / outSize;
  const filterscale = scale < 1 ? 1 : scale;
  const support = 2.0 * filterscale;
  const ksize = Math.ceil(support) * 2 + 1;
  const kk = new Int32Array(outSize * ksize);
  const bounds = new Int32Array(outSize * 2);
  const k = new Float64Array(ksize);
  for (let xx = 0; xx < outSize; xx++) {
    const center = (xx + 0.5) * scale;
    const ss = 1.0 / filterscale;
    let xmin = Math.trunc(center - support + 0.5);
    if (xmin < 0) xmin = 0;
    let xmax = Math.trunc(center + support + 0.5);
    if (xmax > inSize) xmax = inSize;
    xmax -= xmin;
    let ww = 0;
    for (let x = 0; x < xmax; x++) {
      const w = bicubic((x + xmin - center + 0.5) * ss);
      k[x] = w;
      ww += w;
    }
    for (let x = 0; x < xmax; x++) {
      const w = ww !== 0 ? k[x]! / ww : k[x]!;
      kk[xx * ksize + x] = Math.trunc(w * SCALE + (w < 0 ? -0.5 : 0.5));
    }
    bounds[xx * 2] = xmin;
    bounds[xx * 2 + 1] = xmax;
  }
  return { bounds, kk, ksize };
}

const clip8 = (ss: number) => {
  const v = Math.floor(ss / SCALE);
  return v < 0 ? 0 : v > 255 ? 255 : v;
};

/** Bicubic resize of an RGB image (3 bytes per pixel), matching Pillow's Image.resize(..., BICUBIC). */
export function resizeRgb(
  rgb: Uint8Array,
  width: number,
  height: number,
  outW: number,
  outH: number,
): Uint8Array {
  let src = rgb;
  let w = width;
  if (outW !== width) {
    const { bounds, kk, ksize } = coefficients(width, outW);
    const out = new Uint8Array(outW * height * 3);
    for (let y = 0; y < height; y++) {
      for (let xx = 0; xx < outW; xx++) {
        const xmin = bounds[xx * 2]!;
        const xmax = bounds[xx * 2 + 1]!;
        let s0 = HALF;
        let s1 = HALF;
        let s2 = HALF;
        for (let x = 0; x < xmax; x++) {
          const kv = kk[xx * ksize + x]!;
          const i = (y * width + x + xmin) * 3;
          s0 += src[i]! * kv;
          s1 += src[i + 1]! * kv;
          s2 += src[i + 2]! * kv;
        }
        const o = (y * outW + xx) * 3;
        out[o] = clip8(s0);
        out[o + 1] = clip8(s1);
        out[o + 2] = clip8(s2);
      }
    }
    src = out;
    w = outW;
  }
  if (outH !== height) {
    const { bounds, kk, ksize } = coefficients(height, outH);
    const out = new Uint8Array(w * outH * 3);
    for (let yy = 0; yy < outH; yy++) {
      const ymin = bounds[yy * 2]!;
      const ymax = bounds[yy * 2 + 1]!;
      for (let x = 0; x < w; x++) {
        let s0 = HALF;
        let s1 = HALF;
        let s2 = HALF;
        for (let y = 0; y < ymax; y++) {
          const kv = kk[yy * ksize + y]!;
          const i = ((y + ymin) * w + x) * 3;
          s0 += src[i]! * kv;
          s1 += src[i + 1]! * kv;
          s2 += src[i + 2]! * kv;
        }
        const o = (yy * w + x) * 3;
        out[o] = clip8(s0);
        out[o + 1] = clip8(s1);
        out[o + 2] = clip8(s2);
      }
    }
    src = out;
  }
  return src;
}

export function toRgb(p: Pixels): Uint8Array {
  const n = p.width * p.height;
  const out = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    out[i * 3] = p.data[i * 4]!;
    out[i * 3 + 1] = p.data[i * 4 + 1]!;
    out[i * 3 + 2] = p.data[i * 4 + 2]!;
  }
  return out;
}

/** Output size when the short edge becomes `short` (Hugging Face's get_resize_output_image_size). */
export function shortEdgeSize(width: number, height: number, short: number): [number, number] {
  if (width <= height) return [short, Math.floor((short * height) / width)];
  return [Math.floor((short * width) / height), short];
}

/** Full pipeline: RGBA pixels in, normalised CHW float32 tensor out (length 3 * crop * crop). */
export function preprocessForClassifier(p: Pixels, spec: PreprocessSpec): Float32Array {
  const [rw, rh] = shortEdgeSize(p.width, p.height, spec.resizeShortEdge);
  const resized = resizeRgb(toRgb(p), p.width, p.height, rw, rh);
  const c = spec.cropSize;
  if (rw < c || rh < c) throw new RangeError('image too small for the crop');
  const top = Math.floor((rh - c) / 2);
  const left = Math.floor((rw - c) / 2);
  const out = new Float32Array(3 * c * c);
  for (let y = 0; y < c; y++) {
    for (let x = 0; x < c; x++) {
      const i = ((top + y) * rw + (left + x)) * 3;
      for (let ch = 0; ch < 3; ch++) {
        const v = resized[i + ch]! * (1 / 255);
        out[ch * c * c + y * c + x] = (v - spec.mean[ch]!) / spec.std[ch]!;
      }
    }
  }
  return out;
}
