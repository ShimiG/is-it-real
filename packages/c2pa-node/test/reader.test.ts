import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkImageProvenance, summarizeManifestStore } from '@isitreal/core';
import { createC2paReader } from '../src/index.js';

const fixture = (name: string) =>
  readFile(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', name));
const reader = createC2paReader();

describe('C2PA reader on real files', () => {
  it('reads a valid manifest that does not declare AI', async () => {
    const summary = summarizeManifestStore(
      await reader.read(await fixture('C.jpg'), 'image/jpeg'),
    )!;
    expect(summary).toMatchObject({
      state: 'valid', // intact, but signed with the public test certificate
      aiDeclared: false,
      digitalSourceTypes: ['algorithmicMedia'],
      issuer: 'C2PA Test Signing Cert',
      failures: [],
    });
    const verdict = await checkImageProvenance(await fixture('C.jpg'), reader);
    expect(verdict).toMatchObject({
      outcome: 'no_clear_signs',
      reasons: ['c2pa_present_no_ai_claim'],
    });
  });

  it('gives "Made with AI" for a signed AI declaration, noting the unrecognised signer', async () => {
    const verdict = await checkImageProvenance(await fixture('ai-declared.jpg'), reader);
    expect(verdict.outcome).toBe('verified_ai');
    expect(verdict.reasons).toEqual(['c2pa_declares_ai', 'c2pa_signer_unrecognised']);
    const c2pa = verdict.signals.find((s) => s.detector.startsWith('image.c2pa'))!;
    expect(c2pa.details).toMatchObject({
      state: 'valid',
      generators: 'IsItReal test fixtures, Example Image Generator',
    });
  });

  it('does not trust a manifest whose image was changed after signing', async () => {
    const summary = summarizeManifestStore(
      await reader.read(await fixture('XCA.jpg'), 'image/jpeg'),
    )!;
    expect(summary.state).toBe('invalid');
    expect(summary.failures).toContain('assertion.dataHash.mismatch');
    const verdict = await checkImageProvenance(await fixture('XCA.jpg'), reader);
    expect(verdict).toMatchObject({
      outcome: 'no_clear_signs',
      reasons: ['c2pa_invalid_signature'],
    });
  });

  it('returns null for a file with no manifest', async () => {
    expect(await reader.read(await fixture('plain.jpg'), 'image/jpeg')).toBeNull();
    const verdict = await checkImageProvenance(await fixture('plain.jpg'), reader);
    expect(verdict).toMatchObject({ outcome: 'no_clear_signs', reasons: [] });
  });

  it('stops being "Made with AI" when the declared image is tampered with', async () => {
    const bytes = new Uint8Array(await fixture('ai-declared.jpg'));
    // Flip some image bytes near the end of the file (after the manifest).
    for (let i = bytes.length - 400; i < bytes.length - 380; i++) bytes[i] = bytes[i]! ^ 0xff;
    const verdict = await checkImageProvenance(bytes, reader);
    expect(verdict.outcome).toBe('no_clear_signs');
    expect(verdict.reasons).toEqual(['c2pa_invalid_signature']);
  });
});
