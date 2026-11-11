import { conformalScore } from '../calibration.js';
import type { DetectorResult } from '../types.js';
import { isPhotoLike, type PhotoGate } from './photo-gate.js';
import { preprocessForClassifier, type PreprocessSpec } from './preprocess.js';
import type { Pixels } from './spectral.js';

/**
 * Statistical image check: a small pretrained image classifier used as a measuring instrument
 * (ADR-0001: a model may measure, it never "decides" in words). The raw output is turned into a
 * conformal score from held-out REAL photos (calibration.ts), so "Likely made with AI" (score >= 0.99)
 * flags at most about 1 in 100 real photos like the calibration set.
 *
 * The weights are not shipped in the repository. A host downloads the model file named here,
 * checks its sha256, and provides a runner (ONNX Runtime in Node or in the browser).
 */
export interface ImageClassifierModel extends PreprocessSpec {
  /** Detector id, versioned with its calibration: e.g. `image.classifier.cf-lq@0.1.0`. */
  id: string;
  /** Model file this calibration belongs to. A runner for a different file is refused. */
  runnerId: string;
  file: string;
  url: string;
  sha256: string;
  bytes: number;
  license: string;
  /** Images smaller than this on their short side are not assessed. */
  minSide: number;
  /** Raw outputs (logits, higher = more AI-like) of held-out real photos, ascending. */
  calibration: number[];
  trainedOn: string;
  calibratedOn: string;
}

/** Host-provided model runner: takes the normalised CHW tensor, returns one raw logit. */
export interface ImageClassifierRunner {
  id: string;
  run(input: Float32Array, size: number): Promise<number>;
}

export async function detectImageClassifier(
  pixels: Pixels,
  runner: ImageClassifierRunner,
  model: ImageClassifierModel,
): Promise<DetectorResult> {
  if (runner.id !== model.runnerId)
    throw new Error(
      `Calibration ${model.id} belongs to ${model.runnerId}, but the runner is ${runner.id}`,
    );
  if (Math.min(pixels.width, pixels.height) < model.minSide)
    return { status: 'not_assessed', detector: model.id, reason: 'too_short' };
  const raw = await runner.run(preprocessForClassifier(pixels, model), model.cropSize);
  return {
    status: 'assessed',
    signal: {
      detector: model.id,
      modality: 'image',
      kind: 'statistical',
      score: conformalScore(raw, model.calibration),
      reasons: ['image_classifier_ai'],
      details: { raw: Number(raw.toFixed(4)), calibrationSize: model.calibration.length },
    },
  };
}

/** Everything a host needs to add the statistical check to `checkImage`. */
export interface ImageStatisticalCheck {
  decode: (bytes: Uint8Array) => Promise<Pixels | null>;
  /** Decides whether the image is photo-like. The picture model only judges images that pass. */
  gate: PhotoGate;
  runner: ImageClassifierRunner;
  model: ImageClassifierModel;
}

/**
 * Decode, gate, then classify. Drawings, illustrations and screenshots get "not assessed":
 * the picture model is not calibrated for them and would raise many false alarms.
 */
export async function runImageStatisticalCheck(
  bytes: Uint8Array,
  check: ImageStatisticalCheck,
): Promise<DetectorResult> {
  const pixels = await check.decode(bytes);
  if (pixels === null)
    return { status: 'not_assessed', detector: check.model.id, reason: 'unreadable_media' };
  if (Math.min(pixels.width, pixels.height) < check.model.minSide)
    return { status: 'not_assessed', detector: check.model.id, reason: 'too_short' };
  if (!(await isPhotoLike(pixels, check.gate)))
    return { status: 'not_assessed', detector: check.model.id, reason: 'not_a_photo' };
  return detectImageClassifier(pixels, check.runner, check.model);
}
