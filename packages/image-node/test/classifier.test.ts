import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ort from 'onnxruntime-node';
import { describe, expect, it } from 'vitest';
import {
  IMAGE_CLASSIFIER_MODEL,
  checkImage,
  detectImageClassifier,
  type ImageClassifierModel,
  type Pixels,
} from '@isitreal/core';
import { decodeImage, loadImageClassifierWith } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const standin = join(here, 'fixtures', 'standin-classifier.onnx');
const fixture = (name: string) =>
  readFile(join(here, '..', '..', 'c2pa-node', 'test', 'fixtures', name));

/** A calibration where the stand-in's logit (4 x mean normalised red) is compared with 100 "real" scores. */
const model: ImageClassifierModel = {
  id: 'image.classifier.standin@0',
  runnerId: 'standin',
  file: 'standin-classifier.onnx',
  url: '',
  sha256: '',
  bytes: 336,
  license: 'test',
  resizeShortEdge: 440,
  cropSize: 384,
  mean: [0.5, 0.5, 0.5],
  std: [0.5, 0.5, 0.5],
  minSide: 64,
  calibration: Array.from({ length: 100 }, (_, i) => -4 + (i * 6) / 99), // -4 .. 2
  trainedOn: 'nothing',
  calibratedOn: 'synthetic',
};

const flat = (w: number, h: number, r: number): Pixels => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([r, 0, 0, 255], i * 4);
  return { width: w, height: h, data };
};

describe('ONNX image classifier runner', () => {
  it('runs a model and returns its raw logit', async () => {
    const runner = await loadImageClassifierWith(ort, 'standin', standin);
    const red = await runner.run(new Float32Array(3 * 384 * 384).fill(0.5), 384);
    expect(red).toBeCloseTo(2, 5);
  });

  it('turns the logit into a conformal score from real-photo calibration', async () => {
    const runner = await loadImageClassifierWith(ort, 'standin', standin);
    // All-red image: normalised red = 1, logit 4, above every calibration score.
    const high = await detectImageClassifier(flat(500, 500, 255), runner, model);
    expect(high).toMatchObject({
      status: 'assessed',
      signal: { kind: 'statistical', reasons: ['image_classifier_ai'] },
    });
    if (high.status === 'assessed') expect(high.signal.score).toBeCloseTo(1 - 1 / 101, 6);
    // No red: logit -4, at the bottom.
    const low = await detectImageClassifier(flat(500, 500, 0), runner, model);
    if (low.status === 'assessed') expect(low.signal.score).toBeLessThan(0.05);
  });

  it('refuses tiny images and a runner for a different model', async () => {
    const runner = await loadImageClassifierWith(ort, 'standin', standin);
    expect(await detectImageClassifier(flat(40, 400, 255), runner, model)).toMatchObject({
      status: 'not_assessed',
      reason: 'too_short',
    });
    const other = await loadImageClassifierWith(ort, 'other', standin);
    await expect(detectImageClassifier(flat(500, 500, 255), other, model)).rejects.toThrow(
      /belongs to standin/,
    );
  });

  it('is only consulted when the file and the site declare nothing', async () => {
    const runner = await loadImageClassifierWith(ort, 'standin', standin);
    let calls = 0;
    const counting = {
      id: 'standin',
      run: async (t: Float32Array, s: number) => (calls++, runner.run(t, s)),
    };
    const statistical = { decode: decodeImage, runner: counting, model };
    // A plain photo: the classifier runs.
    const plain = await checkImage(
      { bytes: new Uint8Array(await fixture('plain.jpg')) },
      { statistical },
    );
    expect(calls).toBe(1);
    expect(plain.signals.some((s) => s.kind === 'statistical')).toBe(true);
    // An image with a platform AI label: no need to run it.
    await checkImage(
      { bytes: new Uint8Array(await fixture('plain.jpg')), nearbyLabels: ['AI info'] },
      { hostname: 'www.instagram.com', statistical },
    );
    expect(calls).toBe(1);
  });
});

/**
 * The SHIPPED model on the owner's real downloads (local only: needs the 44 MB model and the
 * private files). Perchance carries no label, so only the picture model can catch it.
 */
const cache = join(here, '..', '..', '..', 'eval', 'datasets', '.cache');
const shippedModel = join(cache, 'models', 'image', 'tf-low-quality', 'model_fp16.onnx');
const perchance = join(cache, 'private', 'perchance-originals', 'perchance-1.jpeg');
describe.skipIf(!existsSync(shippedModel) || !existsSync(perchance))(
  'shipped picture model (local only)',
  () => {
    it('turns the unlabelled Perchance image into "Likely made with AI"', async () => {
      const runner = await loadImageClassifierWith(
        ort,
        IMAGE_CLASSIFIER_MODEL.runnerId,
        shippedModel,
      );
      const statistical = { decode: decodeImage, runner, model: IMAGE_CLASSIFIER_MODEL };
      const verdict = await checkImage(
        { bytes: new Uint8Array(await readFile(perchance)) },
        { statistical },
      );
      expect(verdict.outcome).toBe('likely_ai');
      expect(verdict.reasons).toEqual(['image_classifier_ai']);
    }, 60_000);

    it('leaves a real photo alone', async () => {
      const runner = await loadImageClassifierWith(
        ort,
        IMAGE_CLASSIFIER_MODEL.runnerId,
        shippedModel,
      );
      const statistical = { decode: decodeImage, runner, model: IMAGE_CLASSIFIER_MODEL };
      const verdict = await checkImage(
        { bytes: new Uint8Array(await fixture('plain.jpg')) },
        { statistical },
      );
      expect(verdict.outcome).toBe('no_clear_signs');
    }, 60_000);
  },
);
