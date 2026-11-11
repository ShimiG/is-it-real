import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkImageProvenance, summarizeManifestStore } from '@isitreal/core';
import { createC2paReader } from '../src/index.js';

const fixture = (name: string) =>
  readFile(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', name));
const reader = createC2paReader();
const text = async (name: string) => (await fixture(name)).toString('utf8');

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

  it('reports "trusted" when the signer chains to a trusted root, and drops the unrecognised-signer note', async () => {
    const trusting = createC2paReader({ extraAnchorsPem: await text('test-anchors.pem') });
    const verdict = await checkImageProvenance(await fixture('ai-declared.jpg'), trusting);
    expect(verdict).toMatchObject({ outcome: 'verified_ai', reasons: ['c2pa_declares_ai'] });
    expect(verdict.signals.find((s) => s.detector.startsWith('image.c2pa'))!.details).toMatchObject(
      { state: 'trusted' },
    );
  });

  it('the public test certificate is not on the official trust list', async () => {
    const summary = summarizeManifestStore(
      await reader.read(await fixture('ai-declared.jpg'), 'image/jpeg'),
    )!;
    expect(summary.state).toBe('valid');
    const noList = createC2paReader({ trust: 'none' });
    expect(
      summarizeManifestStore(await noList.read(await fixture('C.jpg'), 'image/jpeg'))!.state,
    ).toBe('valid');
  });
});

describe('AI declarations in the image history', () => {
  it('finds an AI claim in a parent manifest wrapped by a later re-save', async () => {
    const summary = summarizeManifestStore(
      await reader.read(await fixture('history-parent.jpg'), 'image/jpeg'),
    )!;
    expect(summary).toMatchObject({ state: 'valid', aiDeclared: true, aiDeclaredIn: 'history' });
    const verdict = await checkImageProvenance(await fixture('history-parent.jpg'), reader);
    expect(verdict).toMatchObject({
      outcome: 'verified_ai',
      reasons: ['c2pa_history_declares_ai', 'c2pa_signer_unrecognised'],
    });
  });

  it('does not inherit the claim of an ingredient that was only an input', async () => {
    const summary = summarizeManifestStore(
      await reader.read(await fixture('history-input.jpg'), 'image/jpeg'),
    )!;
    expect(summary).toMatchObject({ state: 'valid', aiDeclared: false });
    expect((await checkImageProvenance(await fixture('history-input.jpg'), reader)).outcome).toBe(
      'no_clear_signs',
    );
  });
});

/**
 * Real Gemini images, downloaded from Gemini by the project owner and fetched unchanged from
 * Google Drive (2026-11-11). Not committed (owner's private files); the test runs where they exist.
 */
const geminiDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'eval',
  'datasets',
  '.cache',
  'private',
  'gemini-originals',
);
describe.skipIf(!existsSync(join(geminiDir, 'gemini-2.jpeg')))(
  'real Gemini downloads (local only)',
  () => {
    it.each([
      ['gemini-1.jpeg', 'valid'],
      ['gemini-2.jpeg', 'trusted'],
    ])('%s is "Made with AI" from Google\'s signed history', async (file, state) => {
      const bytes = await readFile(join(geminiDir, file));
      const verdict = await checkImageProvenance(bytes, reader);
      expect(verdict.outcome).toBe('verified_ai');
      expect(verdict.reasons).toContain('c2pa_history_declares_ai');
      const c2pa = verdict.signals.find((s) => s.detector.startsWith('image.c2pa'))!;
      expect(c2pa.details).toMatchObject({ state, issuer: 'Google LLC', aiDeclaredIn: 'history' });
      expect(String(c2pa.details!['aiActions'])).toMatch(/SynthID/);
    });
  },
);

/** A real ChatGPT image (gpt-image), downloaded by the project owner, fetched unchanged from Google Drive. Local only. */
const chatgpt = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'eval',
  'datasets',
  '.cache',
  'private',
  'chatgpt-originals',
  'chatgpt-1.png',
);
describe.skipIf(!existsSync(chatgpt))('real ChatGPT download (local only)', () => {
  it('is "Made with AI" from OpenAI\'s trusted signature, declared in the newest manifest', async () => {
    const verdict = await checkImageProvenance(await readFile(chatgpt), reader);
    expect(verdict).toMatchObject({ outcome: 'verified_ai', reasons: ['c2pa_declares_ai'] });
    const c2pa = verdict.signals.find((s) => s.detector.startsWith('image.c2pa'))!;
    expect(c2pa.details).toMatchObject({
      state: 'trusted',
      issuer: 'OpenAI OpCo, LLC',
      aiDeclaredIn: 'active',
    });
    expect(String(c2pa.details!['generators'])).toMatch(/ChatGPT/);
  });
});

/** A real Microsoft Copilot (Designer) image, downloaded by the project owner, fetched unchanged from Google Drive. Local only. */
const copilot = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'eval',
  'datasets',
  '.cache',
  'private',
  'copilot-originals',
  'copilot-1.png',
);
describe.skipIf(!existsSync(copilot))('real Copilot download (local only)', () => {
  it('is "Made with AI", noting that Microsoft\'s signature does not meet the standard', async () => {
    const verdict = await checkImageProvenance(await readFile(copilot), reader);
    expect(verdict).toMatchObject({
      outcome: 'verified_ai',
      reasons: ['c2pa_declares_ai', 'c2pa_signature_not_standard'],
    });
    const c2pa = verdict.signals.find((s) => s.detector.startsWith('image.c2pa'))!;
    expect(c2pa.details).toMatchObject({ state: 'unverified', issuer: 'Microsoft Corporation' });
    expect(String(c2pa.details!['failures'])).toBe('signingCredential.invalid, claim.malformed');
    expect(String(c2pa.details!['aiActions'])).toMatch(/artificial intelligence/);
  });
});

/** A real Meta AI image, downloaded by the project owner, fetched unchanged from Google Drive. Local only. */
const meta = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'eval',
  'datasets',
  '.cache',
  'private',
  'meta-originals',
  'meta-1.jpg',
);
describe.skipIf(!existsSync(meta))('real Meta AI download (local only)', () => {
  it('is "Made with AI" from the unsigned IPTC label; there are no Content Credentials', async () => {
    const bytes = await readFile(meta);
    expect(await reader.read(bytes, 'image/jpeg')).toBeNull();
    const verdict = await checkImageProvenance(bytes, reader);
    expect(verdict).toMatchObject({
      outcome: 'verified_ai',
      reasons: ['iptc_trained_algorithmic_media'],
    });
  });
});
