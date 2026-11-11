import { existsSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright';
import {
  IMAGE_CLASSIFIER_MODEL,
  PHOTO_GATE_MODEL,
  photoLikeScore,
  preprocessForClassifier,
} from '@isitreal/core';
import {
  decodeImage,
  loadImageClassifierWith,
  loadImageEmbedderWith,
  type OrtLibrary,
} from '@isitreal/image-node';
import { frameAt } from '@isitreal/video-node';
import type { EngineEvent, EngineRequest, PictureScore } from '../src/messages.js';
import {
  browserAvailable,
  launchWithExtension,
  root,
  startServer,
  type Loaded,
} from './browser.js';

/**
 * The picture check in a real Chromium, with the SHIPPED model files (local only: needs both
 * model files and the evaluation images, none of which are in the repository).
 *
 * Decision record 0011 asks that every path gives the same numbers as the evaluation. Here the
 * extension (browser decoding, ONNX Runtime Web) is compared with the plugin path (sharp,
 * onnxruntime-node) on the same pictures, including a phone photo that carries a rotation note.
 */
const cache = join(root, 'eval', 'datasets', '.cache');
const classifierFile = join(cache, 'models', 'image', 'tf-low-quality', 'model_fp16.onnx');
const gateFile = join(cache, 'models', 'image', 'clip-b32', 'vision_model_fp16.onnx');
const manifestFile = join(cache, 'images', 'manifest.jsonl');
/** Stored sideways with a "turn me" note (EXIF orientation 6). */
const ROTATED = 'phone:00bc51498f245159';

const ready =
  browserAvailable() && [classifierFile, gateFile, manifestFile].every((f) => existsSync(f));

describe.skipIf(!ready)('picture check in Chromium with the shipped models (local only)', () => {
  let loaded: Loaded;
  let server: Server;
  let base = '';
  let panel: Page;
  let picks: { id: string; path: string; source: string }[] = [];

  /** Sends one request to the engine from the panel and waits for the answer of the given kind. */
  const ask = <T extends EngineEvent['type']>(request: EngineRequest, want: T) =>
    panel.evaluate(
      ([req, kind]) =>
        new Promise<EngineEvent>((resolve) => {
          const port = chrome.runtime.connect({ name: 'isitreal-engine' });
          port.onMessage.addListener((event: EngineEvent) => {
            if (event.type !== kind && event.type !== 'error') return;
            port.disconnect();
            resolve(event);
          });
          port.postMessage(req);
        }),
      [request, want] as const,
    ) as Promise<Extract<EngineEvent, { type: T }> | Extract<EngineEvent, { type: 'error' }>>;

  beforeAll(async () => {
    const manifest = readFileSync(manifestFile, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { id: string; path: string; source: string });
    picks = ['phone', 'real', 'cosplay', 'gpt', 'gpt25', 'zimage', 'cartoon', 'meme'].flatMap((s) =>
      manifest.filter((m) => m.source === s).slice(0, 2),
    );
    if (!picks.some((p) => p.id === ROTATED)) picks.push(manifest.find((m) => m.id === ROTATED)!);

    // The model files under the names the extension asks for, and a page with three pictures.
    const local = mkdtempSync(join(tmpdir(), 'isitreal-models-'));
    symlinkSync(classifierFile, join(local, IMAGE_CLASSIFIER_MODEL.file));
    symlinkSync(gateFile, join(local, PHOTO_GATE_MODEL.file));
    const src = (id: string) => `/images/${manifest.find((m) => m.id === id)!.path}`;
    writeFileSync(
      join(local, 'pictures.html'),
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Pictures</title></head><body><main>
        <p>Three pictures.</p>
        <img src="${src('zimage:594c198117a32a1b')}" width="300" alt="portrait">
        <img src="${src('phone:0088c4429b5e3241')}" width="300" alt="phone photo">
        <img src="${src('cartoon:0024c06cd03e24ba')}" width="300" alt="cartoon">
      </main></body></html>`,
    );
    ({ server, base } = await startServer({
      '/local/': local,
      '/images/': join(cache, 'images'),
      '/videos/': join(cache, 'videos'),
    }));
    loaded = await launchWithExtension();
    await loaded.worker.evaluate(
      (url) => chrome.storage.local.set({ modelBaseUrl: url }),
      `${base}/local`,
    );
    ({ panel } = await loaded.openPanelFor(`${base}/local/pictures.html`));
  }, 180_000);

  afterAll(async () => {
    await loaded?.context.close();
    server?.close();
  });

  it('downloads both files once, checks them, and says when it is ready', async () => {
    await expect
      .poll(() => panel.locator('#setup-text').innerText(), { timeout: 15_000 })
      .toContain('Not set up yet');
    await panel.getByRole('button', { name: 'Set up the picture check' }).click();
    await expect
      .poll(() => panel.locator('#setup-text').innerText(), { timeout: 120_000 })
      .toContain('Ready');
    expect(await panel.locator('#setup-button').isVisible()).toBe(false);
    const state = await ask({ type: 'models-status' }, 'models');
    expect(state).toEqual({ type: 'models', models: { state: 'ready' } });
  }, 180_000);

  it('gives the same numbers as the plugin on the same pictures', async () => {
    const ort = createRequire(join(root, 'packages', 'image-node', 'package.json'))(
      'onnxruntime-node',
    ) as OrtLibrary;
    const runner = await loadImageClassifierWith(
      ort,
      IMAGE_CLASSIFIER_MODEL.runnerId,
      classifierFile,
    );
    const gate = {
      runner: await loadImageEmbedderWith(ort, PHOTO_GATE_MODEL.runnerId, gateFile),
      model: PHOTO_GATE_MODEL,
    };
    const rows: string[] = [];
    for (const pick of picks) {
      const pixels = (await decodeImage(
        new Uint8Array(readFileSync(join(cache, 'images', pick.path))),
      ))!;
      const expected: PictureScore = {
        width: pixels.width,
        height: pixels.height,
        gate: await photoLikeScore(pixels, gate),
        raw: await runner.run(
          preprocessForClassifier(pixels, IMAGE_CLASSIFIER_MODEL),
          IMAGE_CLASSIFIER_MODEL.cropSize,
        ),
      };
      const answer = await ask(
        { type: 'score-picture', url: `${base}/images/${pick.path}` },
        'score',
      );
      expect(answer.type, pick.id).toBe('score');
      const got = (answer as { score: PictureScore | null }).score!;
      expect(got, pick.id).not.toBeNull();
      rows.push(
        `${pick.id} gate ${got.gate.toFixed(4)}/${expected.gate.toFixed(4)} raw ${got.raw.toFixed(4)}/${expected.raw.toFixed(4)}`,
      );
      expect([got.width, got.height], pick.id).toEqual([expected.width, expected.height]);
      expect(Math.abs(got.gate - expected.gate), pick.id).toBeLessThan(0.01);
      expect(Math.abs(got.raw - expected.raw), pick.id).toBeLessThan(0.02);
    }
    expect(picks.length).toBeGreaterThanOrEqual(16);
    expect(rows.some((r) => r.startsWith(ROTATED))).toBe(true);
  }, 300_000);

  it('judges a page: an unlabelled AI portrait, a phone photo and a drawing', async () => {
    await panel.getByRole('button', { name: /Check/ }).click();
    await expect
      .poll(() => panel.locator('.ai .card').count(), { timeout: 120_000 })
      .toBeGreaterThan(1);
    const text = await panel.locator('.ai').innerText();
    expect(text).toContain('Likely made with AI');
    expect(text).toContain('A picture-checking model found features typical of AI images.');
    expect(text).toContain('Our picture check only works on plain photos.');
    expect(text).not.toContain('The picture check is not set up yet');
    // Each result shows a small copy of its picture.
    expect(await panel.locator('.ai img.thumb').count()).toBe(3);
  }, 180_000);

  it('reads video frames to the same numbers as the plugin', async () => {
    // Both take the decoder's raw planes and convert them with the core's one rule: the plugin
    // through ffmpeg, the extension through the browser's video player. Each frame the browser
    // read is fetched again by the plugin's reader at the same moment and scored.
    const clipsFile = join(cache, 'videos', 'manifest.jsonl');
    if (!existsSync(clipsFile)) return;
    const clips = readFileSync(clipsFile, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { id: string; path: string; source: string });
    const fromVideoNode = createRequire(join(root, 'packages', 'video-node', 'package.json'));
    const ffmpeg = fromVideoNode('ffmpeg-static') as string;
    const ort = createRequire(join(root, 'packages', 'image-node', 'package.json'))(
      'onnxruntime-node',
    ) as OrtLibrary;
    const runner = await loadImageClassifierWith(
      ort,
      IMAGE_CLASSIFIER_MODEL.runnerId,
      classifierFile,
    );
    const gate = {
      runner: await loadImageEmbedderWith(ort, PHOTO_GATE_MODEL.runnerId, gateFile),
      model: PHOTO_GATE_MODEL,
    };
    const report: string[] = [];
    let compared = 0;
    // OpenVid clips are left out: they use MPEG-4 Part 2, which browsers do not play.
    for (const source of ['dfd_real', 'msrvtt', 'veo31', 'kling', 'sora2', 'wan21', 'seedance']) {
      for (const clip of clips.filter((c) => c.source === source).slice(0, 2)) {
        const answer = await ask(
          { type: 'score-video', url: `${base}/videos/${clip.path}` },
          'video-score',
        );
        expect(answer.type, `${clip.id} ${JSON.stringify(answer).slice(0, 300)}`).toBe(
          'video-score',
        );
        const frames = (answer as { frames: PictureScore[] | null }).frames!;
        expect(frames, clip.id).toHaveLength(6);
        for (const [k, got] of frames.entries()) {
          // The plugin's reader gives the first frame at or after the asked time.
          const pixels = await frameAt(ffmpeg, join(cache, 'videos', clip.path), got.time! - 0.002);
          expect(pixels, `${clip.id} frame ${k}`).not.toBeNull();
          const want = {
            gate: await photoLikeScore(pixels!, gate),
            raw: await runner.run(
              preprocessForClassifier(pixels!, IMAGE_CLASSIFIER_MODEL),
              IMAGE_CLASSIFIER_MODEL.cropSize,
            ),
          };
          report.push(
            `${clip.id} frame ${k} at ${got.time!.toFixed(3)} s: gate ${got.gate.toFixed(4)}/${want.gate.toFixed(4)} raw ${got.raw.toFixed(4)}/${want.raw.toFixed(4)}`,
          );
          expect([got.width, got.height], `${clip.id} frame ${k}`).toEqual([
            pixels!.width,
            pixels!.height,
          ]);
          expect(Math.abs(got.gate - want.gate), report.at(-1)).toBeLessThan(0.01);
          expect(Math.abs(got.raw - want.raw), report.at(-1)).toBeLessThan(0.02);
          compared++;
        }
      }
    }
    writeFileSync(join(tmpdir(), 'isitreal-video-parity.txt'), report.join('\n') + '\n');
    expect(compared).toBe(84);
  }, 900_000);

  it('checks a streamed video while it plays', async () => {
    // The clip reaches the player as a blob, like video on a video site: no file to fetch.
    const clipsFile = join(cache, 'videos', 'manifest.jsonl');
    if (!existsSync(clipsFile)) return;
    const pathOf = (id: string) =>
      (
        readFileSync(clipsFile, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((l) => JSON.parse(l) as { id: string; path: string })
          .find((c) => c.id === id) ?? { path: '' }
      ).path;
    const watchClip = async (id: string) => {
      const opened = await loaded.openPanelFor(
        `${base}/stream-page.html?src=${encodeURIComponent(`/videos/${pathOf(id)}`)}`,
      );
      await opened.page.waitForFunction(
        () => (document.getElementById('player') as HTMLVideoElement).currentTime > 0.2,
      );
      await opened.panel.getByRole('button', { name: /Check/ }).click();
      const button = opened.panel.getByRole('button', { name: 'Check this video while it plays' });
      await expect.poll(() => button.count(), { timeout: 60_000 }).toBe(1);
      await button.click();
      // The card is replaced by the answer; the button goes away with it.
      await expect.poll(() => button.count(), { timeout: 120_000 }).toBe(0);
      return opened.panel.locator('.ai').innerText();
    };
    const ai = await watchClip('seedance:072bc6528b84e8ab');
    expect(ai).toContain('Video 1: Likely made with AI');
    expect(ai).toContain('We looked at a few frames while the video played.');
    expect(ai).toContain('cannot detect a face swap');
    const real = await watchClip('dfd_real:005b70c6935ad68b');
    expect(real).toContain('Video 1: No clear signs');
  }, 600_000);
});
