import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkVideoProvenance } from '@isitreal/core';
import { createC2paReader } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFile(join(here, 'fixtures', name));
const reader = createC2paReader();

describe('Content Credentials in video files', () => {
  it('gives "Made with AI" for a signed AI declaration in an MP4', async () => {
    const verdict = await checkVideoProvenance(await fixture('ai-declared.mp4'), reader);
    expect(verdict).toMatchObject({
      modality: 'video',
      outcome: 'verified_ai',
      reasons: ['c2pa_declares_ai', 'c2pa_signer_unrecognised'],
    });
    expect(verdict.signals.find((s) => s.detector.startsWith('video.c2pa'))?.details).toMatchObject(
      {
        state: 'valid',
        issuer: 'C2PA Test Signing Cert',
        generators: 'IsItReal test fixtures, Test video generator',
      },
    );
  });

  it('does not believe the declaration when the video was changed after signing', async () => {
    const verdict = await checkVideoProvenance(await fixture('ai-declared-cut.mp4'), reader);
    expect(verdict).toMatchObject({
      outcome: 'no_clear_signs',
      reasons: ['c2pa_invalid_signature'],
    });
  });

  it('finds nothing in an unsigned video', async () => {
    const plain = await readFile(
      join(here, '..', '..', 'video-node', 'test', 'fixtures', 'testsrc.mp4'),
    );
    expect(await checkVideoProvenance(plain, reader)).toMatchObject({
      outcome: 'no_clear_signs',
      reasons: [],
    });
  });
});

/** Real Sora 2 downloads from the evaluation set (local only: the clips are not redistributed). */
const sora = join(here, '..', '..', '..', 'eval', 'datasets', '.cache', 'videos', 'sora2');
const clips = existsSync(sora) ? readdirSync(sora).slice(0, 5) : [];
describe.skipIf(clips.length === 0)('real Sora 2 downloads (local only)', () => {
  it('are recognised as made with AI from their Content Credentials', async () => {
    for (const clip of clips) {
      const verdict = await checkVideoProvenance(await readFile(join(sora, clip)), reader);
      expect(verdict.outcome, clip).toBe('verified_ai');
      expect(verdict.reasons[0], clip).toBe('c2pa_declares_ai');
      const c2pa = verdict.signals.find((s) => s.detector.startsWith('video.c2pa'));
      expect(c2pa?.details, clip).toMatchObject({ issuer: 'OpenAI', generators: 'Sora' });
    }
  }, 60_000);
});

/**
 * How many clips of the video evaluation set carry a signed AI declaration (local only). These
 * counts are quoted in docs/eval/m5-results.md.
 */
const videos = join(here, '..', '..', '..', 'eval', 'datasets', '.cache', 'videos');
const sources = ['sora2', 'sora1', 'runway', 'portrait', 'veo31', 'kling'];
describe.skipIf(!sources.every((s) => existsSync(join(videos, s))))(
  'signed declarations in the video evaluation set (local only)',
  () => {
    it('finds them in every Sora, Sora 2 and Runway file, some portraits, no Veo or Kling file', async () => {
      const counts: Record<string, { n: number; declared: number; broken: number }> = {};
      for (const source of sources) {
        const c = (counts[source] = { n: 0, declared: 0, broken: 0 });
        for (const clip of readdirSync(join(videos, source))) {
          const verdict = await checkVideoProvenance(
            await readFile(join(videos, source, clip)),
            reader,
          );
          c.n++;
          if (verdict.outcome === 'verified_ai') c.declared++;
          if (verdict.reasons.includes('c2pa_invalid_signature')) c.broken++;
        }
      }
      expect(counts).toEqual({
        sora2: { n: 50, declared: 50, broken: 0 },
        sora1: { n: 50, declared: 50, broken: 0 },
        runway: { n: 50, declared: 50, broken: 0 },
        portrait: { n: 127, declared: 26, broken: 20 },
        veo31: { n: 50, declared: 0, broken: 0 },
        kling: { n: 50, declared: 0, broken: 0 },
      });
    }, 300_000);
  },
);
