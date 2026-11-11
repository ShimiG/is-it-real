/**
 * The SHIPPED video frame check against the evaluation table (local only: needs both model files
 * and the evaluation clips, none of which are in the repository).
 *
 * The evaluation scores frames in Python with the system ffmpeg; users get them from this code
 * with the packaged ffmpeg. Decision record 0011 (amendment 2) asks that the two paths give the
 * same numbers, so this is checked on real clips.
 */
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PHOTO_GATE_MODEL, VIDEO_FRAMES_MODEL, detectVideoFrames, median } from '@isitreal/core';
import { lazyImageCheck, lazyVideoCheck, type LoadSettings } from '../src/load.js';

const here = dirname(fileURLToPath(import.meta.url));
const packages = join(here, '..', '..');
const evalDir = join(packages, '..', 'eval');
const cache = join(evalDir, 'datasets', '.cache');
const shippedModel = join(cache, 'models', 'image', 'tf-low-quality', 'model_fp16.onnx');
const shippedGate = join(cache, 'models', 'image', 'clip-b32', 'vision_model_fp16.onnx');
const manifestFile = join(cache, 'videos', 'manifest.jsonl');
const tableFile = join(evalDir, 'features', 'video-scores.v1.jsonl');

interface TableRow {
  id: string;
  source: string;
  version: string;
  gate: number[];
  logit: number[];
}

describe.skipIf(![shippedModel, shippedGate, manifestFile, tableFile].every((f) => existsSync(f)))(
  'shipped video frame check (local only)',
  () => {
    const settings: LoadSettings = {
      dataDir: mkdtempSync(join(tmpdir(), 'isitreal-video-')),
      trustDir: '',
      autoInstall: false,
      imageModel: true,
      nativeFrom: join(packages, 'image-node'),
      imageModelPath: shippedModel,
      gateModelPath: shippedGate,
      video: true,
      ffmpegPath: createRequire(join(packages, 'video-node', 'package.json'))(
        'ffmpeg-static',
      ) as string,
    };

    it('gives the same video numbers as the evaluation table', async () => {
      const check = await lazyVideoCheck(settings, lazyImageCheck(settings))();
      expect(check).not.toBeNull();
      expect(check!.frameCheck.model.id).toBe(VIDEO_FRAMES_MODEL.id);
      const table = new Map<string, TableRow>();
      for (const line of readFileSync(tableFile, 'utf8')
        .split('\n')
        .filter((l) => l.startsWith('{'))) {
        const r = JSON.parse(line) as TableRow;
        if (r.version === 'original') table.set(r.id, r);
      }
      const manifest = readFileSync(manifestFile, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { id: string; path: string; source: string });
      const threshold = PHOTO_GATE_MODEL.threshold;
      let judged = 0;
      let notJudged = 0;
      for (const source of ['openvid', 'dfd_real', 'msrvtt', 'veo31', 'kling', 'sora2', 'wan21']) {
        // Frames whose gate score sits on the threshold could fall either way; skip those clips.
        const clear = manifest.filter((m) => {
          const row = table.get(m.id);
          return (
            m.source === source &&
            row !== undefined &&
            row.gate.every((g) => Math.abs(g - threshold) > 0.05)
          );
        });
        for (const item of clear.slice(0, 3)) {
          const row = table.get(item.id)!;
          const expected = row.logit.filter((_, i) => row.gate[i]! >= threshold);
          const frames = await check!.extractFrames(
            join(cache, 'videos', item.path),
            VIDEO_FRAMES_MODEL.frames,
          );
          const result = await detectVideoFrames(frames ?? [], check!.frameCheck);
          if (expected.length < VIDEO_FRAMES_MODEL.minChecked) {
            expect(result.status, item.id).toBe('not_assessed');
            notJudged++;
            continue;
          }
          expect(result.status, item.id).toBe('assessed');
          if (result.status !== 'assessed') continue;
          const details = result.signal.details as { raw: number; framesChecked: number };
          expect(details.framesChecked, item.id).toBe(expected.length);
          // The evaluation uses the float32 copy of the picture model, the plugin the float16 one
          // (largest difference measured on images: 0.07).
          expect(Math.abs(details.raw - median(expected)), item.id).toBeLessThan(0.15);
          judged++;
        }
      }
      expect(judged).toBeGreaterThanOrEqual(15);
      expect(judged + notJudged).toBe(21);
    }, 600_000);
  },
);
