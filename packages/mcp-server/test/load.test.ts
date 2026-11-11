import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { IMAGE_CLASSIFIER_MODEL, PHOTO_GATE_MODEL, type VideoFramesModel } from '@isitreal/core';
import { dataDir, lazyImageCheck, lazyVideoCheck, type LoadSettings } from '../src/load.js';

describe('dataDir', () => {
  it('prefers ISITREAL_DATA, then the plugin data folder', () => {
    expect(dataDir({ ISITREAL_DATA: '/a', CLAUDE_PLUGIN_DATA: '/b' })).toBe('/a');
    expect(dataDir({ CLAUDE_PLUGIN_DATA: '/b' })).toBe('/b');
  });

  it('ignores placeholders that were not filled in, and relative paths', () => {
    expect(dataDir({ ISITREAL_DATA: '${CLAUDE_PLUGIN_DATA}', CLAUDE_PLUGIN_DATA: '/b' })).toBe(
      '/b',
    );
    expect(dataDir({ ISITREAL_DATA: 'relative/dir' })).toBe(join(homedir(), '.is-it-real'));
    expect(dataDir({})).toBe(join(homedir(), '.is-it-real'));
  });
});

describe('lazyImageCheck', () => {
  const imageNode = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'image-node');
  const fixtures = join(imageNode, 'test', 'fixtures');
  const videoNode = join(imageNode, '..', 'video-node');
  /** The packaged ffmpeg from the workspace (a development dependency of video-node). */
  const ffmpeg = createRequire(join(videoNode, 'package.json'))('ffmpeg-static') as string;
  const clip = join(videoNode, 'test', 'fixtures', 'testsrc.mp4');
  const videoModel: VideoFramesModel = {
    id: 'video.frames.test@1',
    imageModelId: IMAGE_CLASSIFIER_MODEL.id,
    gateId: PHOTO_GATE_MODEL.id,
    frames: 6,
    minChecked: 4,
    calibration: [0, 1, 2],
    calibratedOn: 'synthetic',
  };
  const settings = (over: Partial<LoadSettings> = {}): LoadSettings => ({
    dataDir: mkdtempSync(join(tmpdir(), 'isitreal-load-')),
    trustDir: '',
    autoInstall: false,
    imageModel: true,
    nativeFrom: imageNode,
    imageModelPath: join(fixtures, 'standin-classifier.onnx'),
    gateModelPath: join(fixtures, 'standin-gate.onnx'),
    video: true,
    ffmpegPath: ffmpeg,
    ...over,
  });

  it('loads the picture model together with its photo gate', async () => {
    const check = await lazyImageCheck(settings())();
    expect(check?.model.id).toBe(IMAGE_CLASSIFIER_MODEL.id);
    expect(check?.gate.model.id).toBe(PHOTO_GATE_MODEL.id);
    expect(check?.gate.runner.id).toBe(PHOTO_GATE_MODEL.runnerId);
  });

  it('gives no picture check without the gate: never the model on its own', async () => {
    // No gate file and no permission to download one.
    expect(await lazyImageCheck(settings({ gateModelPath: undefined }))()).toBeNull();
    // A gate that was never trained.
    const untrained = {
      ...PHOTO_GATE_MODEL,
      logistic: { ...PHOTO_GATE_MODEL.logistic, weights: [] },
    };
    expect(await lazyImageCheck(settings(), IMAGE_CLASSIFIER_MODEL, untrained)()).toBeNull();
    // An encoder whose output does not fit the gate.
    expect(
      await lazyImageCheck(
        settings({ gateModelPath: join(fixtures, 'standin-classifier.onnx') }),
      )(),
    ).toBeNull();
  });

  it('can be switched off', async () => {
    expect(await lazyImageCheck(settings({ imageModel: false }))()).toBeNull();
  });

  it('adds the video frame check when ffmpeg works', async () => {
    const st = settings();
    const video = await lazyVideoCheck(st, lazyImageCheck(st), videoModel)();
    expect(video?.frameCheck.model.id).toBe('video.frames.test@1');
    expect(video?.frameCheck.imageModel.id).toBe(IMAGE_CLASSIFIER_MODEL.id);
    const frames = await video!.extractFrames(clip, 6);
    expect(frames).toHaveLength(6);
    expect([frames[0]!.width, frames[0]!.height]).toEqual([320, 240]);
  }, 60_000);

  it('gives no video frame check without ffmpeg, the picture check or a calibration', async () => {
    const broken = settings({ ffmpegPath: '/no/such/ffmpeg' });
    expect(await lazyVideoCheck(broken, lazyImageCheck(broken), videoModel)()).toBeNull();
    const off = settings({ video: false });
    expect(await lazyVideoCheck(off, lazyImageCheck(off), videoModel)()).toBeNull();
    const noPictures = settings({ imageModel: false });
    expect(await lazyVideoCheck(noPictures, lazyImageCheck(noPictures), videoModel)()).toBeNull();
    const st = settings();
    const image = lazyImageCheck(st);
    expect(await lazyVideoCheck(st, image, { ...videoModel, calibration: [] })()).toBeNull();
    expect(await lazyVideoCheck(st, image, { ...videoModel, gateId: 'other@1' })()).toBeNull();
  });
});
