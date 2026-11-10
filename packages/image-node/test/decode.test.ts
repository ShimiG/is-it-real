import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SPECTRAL_FEATURES, spectralFeatures } from '@isitreal/core';
import { decodeImage } from '../src/index.js';

const fixture = (name: string) =>
  readFile(
    join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      'c2pa-node',
      'test',
      'fixtures',
      name,
    ),
  );

describe('decodeImage', () => {
  it('decodes a JPEG to RGBA at native size', async () => {
    const px = (await decodeImage(await fixture('plain.jpg')))!;
    expect(px).toMatchObject({ width: 256, height: 256 });
    expect(px.data.length).toBe(256 * 256 * 4);
    expect(px.data[3]).toBe(255); // opaque alpha added
  });

  it('returns null for bytes that are not an image', async () => {
    expect(await decodeImage(new TextEncoder().encode('not an image'))).toBeNull();
  });

  it('feeds the frequency analysis end to end', async () => {
    const f = spectralFeatures((await decodeImage(await fixture('C.jpg')))!)!;
    for (const k of SPECTRAL_FEATURES) expect(Number.isFinite(f[k]), k).toBe(true);
  });
});
