import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  checkImageProvenance,
  checkVideoProvenance,
  summarizeManifestStore,
  type C2paReader,
} from '@isitreal/core';
import { TRUST_DIR, TRUST_LIST_FILE, createC2paReader } from '@isitreal/c2pa-node';
import { createWasmC2paReader } from '../src/engine/c2pa.js';

/**
 * The extension reads Content Credentials with the WebAssembly build of the official library;
 * the plugin uses the native build. Both must reach the same conclusion about the same file.
 * The WebAssembly build also runs in Node, so this is checked here without a browser.
 */
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const fixtures = join(root, 'packages', 'c2pa-node', 'test', 'fixtures');
const wasmFile = createRequire(import.meta.url).resolve('@contentauth/c2pa-wasm/c2pa.wasm');

const native = createC2paReader();
let wasm: C2paReader;
beforeAll(async () => {
  wasm = await createWasmC2paReader(readFileSync(wasmFile), {
    trustAnchorsPem: readFileSync(join(TRUST_DIR, TRUST_LIST_FILE), 'utf8'),
  });
});

const mimeOf = (file: string) =>
  file.endsWith('.mp4')
    ? 'video/mp4'
    : file.endsWith('.png')
      ? 'image/png'
      : file.endsWith('.webp')
        ? 'image/webp'
        : 'image/jpeg';

/** What the two readers must agree on (everything the verdict is built from). */
async function both(path: string) {
  const bytes = new Uint8Array(readFileSync(path));
  const mime = mimeOf(path);
  const pick = async (reader: C2paReader) => {
    const s = summarizeManifestStore(await reader.read(bytes, mime));
    return s === null
      ? null
      : {
          state: s.state,
          issuer: s.issuer,
          aiDeclared: s.aiDeclared,
          aiDeclaredIn: s.aiDeclaredIn,
          digitalSourceTypes: s.digitalSourceTypes,
          generators: s.generators,
          failures: [...s.failures].sort(),
        };
  };
  return { native: await pick(native), wasm: await pick(wasm) };
}

describe('Content Credentials reader for the browser', () => {
  it('reads a signed AI declaration', async () => {
    const verdict = await checkImageProvenance(
      new Uint8Array(readFileSync(join(fixtures, 'ai-declared.jpg'))),
      wasm,
    );
    expect(verdict.outcome).toBe('verified_ai');
    expect(verdict.reasons).toEqual(['c2pa_declares_ai', 'c2pa_signer_unrecognised']);
  });

  it('returns nothing for a file without a signature, and does not trust a changed file', async () => {
    const plain = new Uint8Array(readFileSync(join(fixtures, 'plain.jpg')));
    expect(await wasm.read(plain, 'image/jpeg')).toBeNull();
    const changed = await checkImageProvenance(
      new Uint8Array(readFileSync(join(fixtures, 'XCA.jpg'))),
      wasm,
    );
    expect(changed).toMatchObject({
      outcome: 'no_clear_signs',
      reasons: ['c2pa_invalid_signature'],
    });
    const video = await checkVideoProvenance(
      new Uint8Array(readFileSync(join(fixtures, 'ai-declared-cut.mp4'))),
      wasm,
    );
    expect(video).toMatchObject({ outcome: 'no_clear_signs', reasons: ['c2pa_invalid_signature'] });
  });

  it.each(readdirSync(fixtures).filter((f) => /\.(jpg|mp4)$/.test(f)))(
    'agrees with the plugin reader on %s',
    async (file) => {
      const r = await both(join(fixtures, file));
      expect(r.wasm).toEqual(r.native);
    },
  );
});

const official = join(
  root,
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
describe.skipIf(!existsSync(official))('official C2PA test images', { timeout: 120_000 }, () => {
  const files = existsSync(official) ? readdirSync(official).filter((f) => /\.jpe?g$/.test(f)) : [];
  it.each(files)('agrees with the plugin reader on %s', async (file) => {
    const r = await both(join(official, file));
    expect(r.wasm).toEqual(r.native);
  });
});

/** The owner's real downloads and real Sora 2 clips (local only; not in the repository). */
const cache = join(root, 'eval', 'datasets', '.cache');
const localFiles = [join(cache, 'private'), join(cache, 'videos', 'sora2')]
  .filter((d) => existsSync(d))
  .flatMap((d) =>
    (readdirSync(d, { recursive: true }) as string[])
      .filter((f) => /\.(jpe?g|png|webp|mp4)$/i.test(f))
      .slice(0, 40)
      .map((f) => join(d, f)),
  );
describe.skipIf(localFiles.length === 0)('real files (local only)', { timeout: 300_000 }, () => {
  it('agrees with the plugin reader on every file', async () => {
    const differences: string[] = [];
    let withManifest = 0;
    for (const path of localFiles) {
      const r = await both(path);
      if (r.native !== null) withManifest++;
      if (JSON.stringify(r.wasm) !== JSON.stringify(r.native))
        differences.push(`${path}: ${JSON.stringify(r)}`);
    }
    expect(differences).toEqual([]);
    expect(withManifest).toBeGreaterThan(5);
  });
});
