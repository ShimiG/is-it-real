import { mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { IMAGE_CLASSIFIER_MODEL, PHOTO_GATE_MODEL } from '@isitreal/core';
import { dataDir, lazyImageCheck, type LoadSettings } from '../src/load.js';

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
  const settings = (over: Partial<LoadSettings> = {}): LoadSettings => ({
    dataDir: mkdtempSync(join(tmpdir(), 'isitreal-load-')),
    trustDir: '',
    autoInstall: false,
    imageModel: true,
    nativeFrom: imageNode,
    imageModelPath: join(fixtures, 'standin-classifier.onnx'),
    gateModelPath: join(fixtures, 'standin-gate.onnx'),
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
});
