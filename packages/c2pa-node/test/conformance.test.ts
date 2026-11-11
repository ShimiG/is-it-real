import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkImageProvenance, summarizeManifestStore } from '@isitreal/core';
import { createC2paReader } from '../src/index.js';

/**
 * Sweep over the official C2PA public test images (c2pa-org/public-testfiles, legacy 1.4 JPEGs).
 * File names encode the expectation: `E-...` and `X...` files are deliberately broken,
 * `A` and `I` have no manifest, the rest are good. Fetched by `pnpm eval:fetch`; skipped if absent.
 */
const dir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'eval',
  'datasets',
  '.cache',
  'src',
  'public-testfiles',
  'legacy',
  '1.4',
  'image',
  'jpeg',
);

/**
 * Known discrepancy (2026-11-10): the repository lists these three 2023 Truepic photos as good,
 * but the current official library (c2pa-rs via @contentauth/c2pa-node 0.10.0) reports
 * `assertion.dataHash.mismatch` for them. We follow the library, which errs on the safe side.
 */
const KNOWN_DISCREPANCIES = new Set([
  'truepic-20230212-camera.jpg',
  'truepic-20230212-landscape.jpg',
  'truepic-20230212-library.jpg',
]);

function expected(file: string): 'none' | 'invalid' | 'unverified' | 'valid' {
  const name = file.replace(/^[a-z]+-\d+-/, '').replace(/\.jpe?g$/, '');
  if (name === 'A' || name === 'I') return 'none';
  if (name.startsWith('E-') || name.startsWith('X')) return 'invalid';
  // Listed as "Invalid credentials" in the repository. The current library reports only an
  // expired signing certificate (content intact), which is our `unverified` state: we cannot
  // confirm the signer, but nothing was changed. It is never shown as a good signature.
  if (file.startsWith('nikon-')) return 'unverified';
  return 'valid';
}

describe.skipIf(!existsSync(dir))('official C2PA test images', () => {
  const reader = createC2paReader();
  const files = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => /\.jpe?g$/.test(f))
        .sort()
    : [];

  it('covers the expected set of files', () => {
    expect(files.length).toBe(26);
  });

  it.each(files.filter((f) => !KNOWN_DISCREPANCIES.has(f)))('%s', async (file) => {
    const summary = summarizeManifestStore(
      await reader.read(readFileSync(join(dir, file)), 'image/jpeg'),
    );
    const want = expected(file);
    if (want === 'none') expect(summary).toBeNull();
    else expect(summary?.state).toBe(want);
  });

  it('never calls any of them "Made with AI" (none declares AI generation)', async () => {
    for (const file of files) {
      const verdict = await checkImageProvenance(readFileSync(join(dir, file)), reader);
      expect(verdict.outcome, file).toBe('no_clear_signs');
    }
  });

  it('known discrepancies stay on the safe side', async () => {
    for (const file of KNOWN_DISCREPANCIES) {
      const summary = summarizeManifestStore(
        await reader.read(readFileSync(join(dir, file)), 'image/jpeg'),
      );
      expect(summary?.state, file).toBe('invalid');
    }
  });
});
