import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ort from 'onnxruntime-node';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  IMAGE_CLASSIFIER_MODEL,
  PHOTO_GATE_MODEL,
  checkImage,
  detectImageClassifier,
  photoLikeScore,
  runImageStatisticalCheck,
  type ImageClassifierModel,
  type PhotoGateModel,
  type Pixels,
} from '@isitreal/core';
import { decodeImage, loadImageClassifierWith, loadImageEmbedderWith } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const standin = join(here, 'fixtures', 'standin-classifier.onnx');
const standinGate = join(here, 'fixtures', 'standin-gate.onnx');
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

/**
 * A gate for the stand-in encoder, whose first three values are the mean red, green and blue.
 * `redWeight` 0 lets everything through; a negative value calls red images "not a photo".
 */
const gateModel = (redWeight: number, bias: number): PhotoGateModel => ({
  id: 'image.photo-gate.standin@0',
  preprocess: { resizeShortEdge: 224, cropSize: 224, mean: [0.5, 0.5, 0.5], std: [0.5, 0.5, 0.5] },
  logistic: {
    features: Array.from({ length: 512 }, (_, i) => `e${i}`),
    mean: new Array<number>(512).fill(0),
    std: new Array<number>(512).fill(1),
    weights: [redWeight, ...new Array<number>(511).fill(0)],
    bias,
  },
  runnerId: 'standin-gate',
  file: 'standin-gate.onnx',
  url: '',
  sha256: '',
  bytes: 247,
  license: 'test',
  threshold: 0.5,
  trainedOn: 'nothing',
});
const openGate = async () => ({
  runner: await loadImageEmbedderWith(ort, 'standin-gate', standinGate),
  model: gateModel(0, 5),
});
const noRedGate = async () => ({ ...(await openGate()), model: gateModel(-10, 0) });

const flat = (w: number, h: number, r: number, g = 0): Pixels => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([r, g, 0, 255], i * 4);
  return { width: w, height: h, data };
};
const png = (r: number, g: number) =>
  sharp({ create: { width: 300, height: 300, channels: 3, background: { r, g, b: 0 } } })
    .png()
    .toBuffer();

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
    const statistical = { decode: decodeImage, gate: await openGate(), runner: counting, model };
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

describe('photo gate', () => {
  it('scores an image from its embedding', async () => {
    const gate = await noRedGate();
    // Stand-in embedding of a flat red image, unit length: (1, -1, -1) / sqrt(3).
    expect(await photoLikeScore(flat(300, 300, 255), gate)).toBeCloseTo(
      1 / (1 + Math.exp(10 / Math.sqrt(3))),
      5,
    );
    expect(await photoLikeScore(flat(300, 300, 0, 255), gate)).toBeGreaterThan(0.99);
  });

  it('keeps images that are not photo-like away from the picture model', async () => {
    let calls = 0;
    const real = await loadImageClassifierWith(ort, 'standin', standin);
    const runner = {
      id: 'standin',
      run: async (t: Float32Array, s: number) => (calls++, real.run(t, s)),
    };
    const check = { decode: decodeImage, gate: await noRedGate(), runner, model };
    // Red: the classifier would call it AI (logit 4), but the gate says it is not a photo.
    expect(await runImageStatisticalCheck(new Uint8Array(await png(255, 0)), check)).toEqual({
      status: 'not_assessed',
      detector: model.id,
      reason: 'not_a_photo',
    });
    expect(calls).toBe(0);
    // Green passes the gate and is judged.
    expect(await runImageStatisticalCheck(new Uint8Array(await png(0, 255)), check)).toMatchObject({
      status: 'assessed',
    });
    expect(calls).toBe(1);
  });

  it('says so in the verdict instead of guessing', async () => {
    const statistical = {
      decode: decodeImage,
      gate: await noRedGate(),
      runner: await loadImageClassifierWith(ort, 'standin', standin),
      model,
    };
    const verdict = await checkImage({ bytes: new Uint8Array(await png(255, 0)) }, { statistical });
    expect(verdict.outcome).toBe('no_clear_signs');
    expect(verdict.reasons).toContain('not_a_photo');
    expect(verdict.signals.some((s) => s.kind === 'statistical')).toBe(false);
  });

  it('refuses an encoder for a different gate, or one with the wrong output size', async () => {
    const gate = await openGate();
    const other = { ...gate, runner: { ...gate.runner, id: 'other' } };
    await expect(photoLikeScore(flat(300, 300, 255), other)).rejects.toThrow(
      /belongs to standin-gate/,
    );
    const short = { ...gate.model, logistic: { ...gate.model.logistic, weights: [1, 2, 3] } };
    await expect(photoLikeScore(flat(300, 300, 255), { ...gate, model: short })).rejects.toThrow(
      /expects 3 values/,
    );
  });
});

/**
 * The SHIPPED picture model and photo gate on the owner's real downloads (local only: needs both model files and the
 * private files).
 */
const cache = join(here, '..', '..', '..', 'eval', 'datasets', '.cache');
const shippedModel = join(cache, 'models', 'image', 'tf-low-quality', 'model_fp16.onnx');
const shippedGate = join(cache, 'models', 'image', 'clip-b32', 'vision_model_quantized.onnx');
const perchance = join(cache, 'private', 'perchance-originals', 'perchance-1.jpeg');
const geminiCopy = join(cache, 'private', 'gemini-chat-upload', '4.webp');
const shipped = async () => ({
  decode: decodeImage,
  gate: {
    runner: await loadImageEmbedderWith(ort, PHOTO_GATE_MODEL.runnerId, shippedGate),
    model: PHOTO_GATE_MODEL,
  },
  runner: await loadImageClassifierWith(ort, IMAGE_CLASSIFIER_MODEL.runnerId, shippedModel),
  model: IMAGE_CLASSIFIER_MODEL,
});
describe.skipIf(!existsSync(shippedModel) || !existsSync(shippedGate) || !existsSync(perchance))(
  'shipped picture model and photo gate (local only)',
  () => {
    it('says "Likely made with AI" for an unlabelled, photo-like AI picture', async () => {
      // A Gemini picture as re-saved by a chat app: no label left, so only the picture model can tell.
      const statistical = await shipped();
      const verdict = await checkImage(
        { bytes: new Uint8Array(await readFile(geminiCopy)) },
        { statistical },
      );
      expect(verdict.outcome).toBe('likely_ai');
      expect(verdict.reasons).toEqual(['image_classifier_ai']);
    }, 60_000);

    it('does not judge the Perchance anime drawing: it is not a photo', async () => {
      // The picture model alone calls this AI, but it says the same of a third of human-made
      // drawings, so its opinion on drawings is worth nothing. The gate keeps it out.
      const statistical = await shipped();
      const verdict = await checkImage(
        { bytes: new Uint8Array(await readFile(perchance)) },
        { statistical },
      );
      expect(verdict.outcome).toBe('no_clear_signs');
      expect(verdict.reasons).toContain('not_a_photo');
    }, 60_000);

    it('leaves a real photo alone', async () => {
      const statistical = await shipped();
      const verdict = await checkImage(
        { bytes: new Uint8Array(await fixture('plain.jpg')) },
        { statistical },
      );
      expect(verdict.outcome).toBe('no_clear_signs');
    }, 60_000);
  },
);
