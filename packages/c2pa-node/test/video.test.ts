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
