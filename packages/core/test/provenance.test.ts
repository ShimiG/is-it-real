import { describe, expect, it } from 'vitest';
import {
  c2paResult,
  checkImageProvenance,
  metadataResult,
  summarizeManifestStore,
} from '../src/index.js';

const store = (over: Record<string, unknown> = {}, action: Record<string, unknown> = {}) => ({
  active_manifest: 'm1',
  validation_state: 'Trusted',
  validation_status: [],
  manifests: {
    m1: {
      claim_generator_info: [{ name: 'Example Camera App' }],
      assertions: [
        { label: 'c2pa.actions.v2', data: { actions: [{ action: 'c2pa.created', ...action }] } },
      ],
      signature_info: { issuer: 'Example CA', time: '2026-01-01T00:00:00Z' },
    },
  },
  ...over,
});
const AI = {
  digitalSourceType: 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia',
};

describe('summarizeManifestStore', () => {
  it('returns null for missing or malformed stores', () => {
    expect(summarizeManifestStore(null)).toBeNull();
    expect(summarizeManifestStore({ active_manifest: 'x', manifests: {} })).toBeNull();
  });

  it('recognises a trusted AI declaration', () => {
    const s = summarizeManifestStore(store({}, AI))!;
    expect(s).toMatchObject({ state: 'trusted', aiDeclared: true, issuer: 'Example CA' });
    expect(c2paResult(s)).toMatchObject({ signal: { score: 1, reasons: ['c2pa_declares_ai'] } });
  });

  it('treats an untrusted signer as intact but unrecognised', () => {
    const s = summarizeManifestStore(
      store(
        { validation_state: 'Valid', validation_status: [{ code: 'signingCredential.untrusted' }] },
        AI,
      ),
    )!;
    expect(s.state).toBe('valid');
    expect(c2paResult(s)).toMatchObject({
      signal: { score: 1, reasons: ['c2pa_declares_ai', 'c2pa_signer_unrecognised'] },
    });
  });

  it('ignores AI claims inside a broken manifest', () => {
    const s = summarizeManifestStore(
      store(
        {
          validation_state: 'Invalid',
          validation_status: [{ code: 'assertion.dataHash.mismatch' }],
        },
        AI,
      ),
    )!;
    expect(s.state).toBe('invalid');
    expect(c2paResult(s)).toMatchObject({
      signal: { score: 0, reasons: ['c2pa_invalid_signature'] },
    });
  });

  it('does not treat a camera photo or algorithmic art as AI', () => {
    for (const t of ['digitalCapture', 'algorithmicMedia'])
      expect(
        summarizeManifestStore(
          store({}, { digitalSourceType: `http://cv.iptc.org/newscodes/digitalsourcetype/${t}` }),
        )!.aiDeclared,
      ).toBe(false);
  });
});

describe('metadata and checkImageProvenance', () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  const jpeg = (extra: string) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, ...enc(extra)]);

  it('flags the IPTC AI source type as a declaration', async () => {
    const bytes = jpeg('<x:xmpmeta>digitalsourcetype/trainedAlgorithmicMedia</x:xmpmeta>');
    expect(metadataResult(bytes)).toMatchObject({
      signal: { score: 1, reasons: ['iptc_trained_algorithmic_media'] },
    });
    expect((await checkImageProvenance(bytes)).outcome).toBe('verified_ai');
  });

  it('says "not assessed" for something that is not an image', async () => {
    expect(await checkImageProvenance(enc('hello'))).toMatchObject({
      outcome: 'not_assessed',
      reasons: ['unreadable_media'],
    });
  });

  it('works without a C2PA reader', async () => {
    expect((await checkImageProvenance(jpeg(''))).outcome).toBe('no_clear_signs');
  });
});
