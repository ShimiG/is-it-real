import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { preprocessForClassifier, resizeRgb, shortEdgeSize } from '@isitreal/core';

/** Pillow reference outputs written by eval/reference/image_parity.py (local only; skipped in CI). */
const dir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'eval',
  'datasets',
  '.cache',
  'parity-images',
);
const index = join(dir, 'index.json');

interface Case {
  id: string;
  width: number;
  height: number;
  outWidth: number;
  outHeight: number;
  base: string;
}

describe.skipIf(!existsSync(index))(
  'bicubic resize matches Pillow byte for byte (real photos)',
  () => {
    const cases = existsSync(index) ? (JSON.parse(readFileSync(index, 'utf8')) as Case[]) : [];
    it.each(cases.map((c) => [c.id, c] as const))('%s', (_id, c) => {
      const src = new Uint8Array(readFileSync(join(dir, `${c.base}.src.rgb`)));
      const want = new Uint8Array(readFileSync(join(dir, `${c.base}.pil440.rgb`)));
      expect(shortEdgeSize(c.width, c.height, 440)).toEqual([c.outWidth, c.outHeight]);
      const got = resizeRgb(src, c.width, c.height, c.outWidth, c.outHeight);
      let mismatches = 0;
      for (let i = 0; i < want.length; i++) if (got[i] !== want[i]) mismatches++;
      expect(mismatches).toBe(0);
    });
  },
);

describe('preprocessing (synthetic)', () => {
  const rgba = (w: number, h: number, f: (x: number, y: number) => [number, number, number]) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) data.set([...f(x, y), 255], (y * w + x) * 4);
    return { width: w, height: h, data };
  };
  const spec = {
    resizeShortEdge: 440,
    cropSize: 384,
    mean: [0.5, 0.5, 0.5] as [number, number, number],
    std: [0.5, 0.5, 0.5] as [number, number, number],
  };

  it('keeps a flat colour flat and normalises it', () => {
    const t = preprocessForClassifier(
      rgba(600, 500, () => [255, 0, 128]),
      spec,
    );
    expect(t.length).toBe(3 * 384 * 384);
    expect(t[0]).toBeCloseTo(1, 5); // red 255 -> (1 - 0.5) / 0.5
    expect(t[384 * 384]).toBeCloseTo(-1, 5); // green 0
    expect(t[2 * 384 * 384 + 1000]).toBeCloseTo((128 / 255 - 0.5) / 0.5, 5);
  });

  it('crops the centre', () => {
    // Left half black, right half white; after a centred crop the edge is in the middle.
    const t = preprocessForClassifier(
      rgba(880, 440, (x) => (x < 440 ? [0, 0, 0] : [255, 255, 255])),
      spec,
    );
    expect(t[10]).toBeCloseTo(-1, 3);
    expect(t[383]).toBeCloseTo(1, 3);
  });

  it('refuses images it cannot crop', () => {
    expect(() =>
      preprocessForClassifier(
        rgba(3, 3, () => [0, 0, 0]),
        { ...spec, resizeShortEdge: 300 },
      ),
    ).toThrow(RangeError);
  });
});
