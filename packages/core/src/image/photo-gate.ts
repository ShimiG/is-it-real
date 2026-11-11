import { applyLogistic, type LogisticModel } from '../logistic.js';
import { preprocessForClassifier, type PreprocessSpec } from './preprocess.js';
import type { Pixels } from './spectral.js';
import model from './photo-gate.model.json' with { type: 'json' };

/**
 * Photo gate: is this image photo-like, or a drawing / illustration / screenshot?
 *
 * The picture model is only calibrated for photo-like images. On human-made cartoons and digital
 * art it raises false alarms about 30% of the time (docs/eval/m3-results.md), so those images
 * must get "Not checked" instead of a guess. This gate decides which images the model may judge.
 *
 * How: a general-purpose image encoder (CLIP ViT-B/32, MIT) turns the image into 512 numbers
 * that describe its content and style; a small logistic model trained in eval/ reads them.
 * Simple pixel statistics were tried first and could not tell digital paintings from photos.
 * Like the picture model, the encoder only measures (ADR-0001); the weights are downloaded on
 * first use and checked by sha256.
 */
export interface PhotoGateModel {
  id: string;
  /** How the encoder wants its input. */
  preprocess: PreprocessSpec;
  /** Logistic model over the unit-length embedding. */
  logistic: LogisticModel;
  /** Encoder file this gate was trained with. A runner for a different file is refused. */
  runnerId: string;
  file: string;
  url: string;
  sha256: string;
  bytes: number;
  license: string;
  /** Images scoring at or above this are treated as photo-like. */
  threshold: number;
  trainedOn: string;
}

/** Host-provided encoder runner: normalised CHW tensor in, embedding vector out. */
export interface ImageEmbeddingRunner {
  id: string;
  run(input: Float32Array, size: number): Promise<Float32Array>;
}

export const PHOTO_GATE_MODEL = model as unknown as PhotoGateModel;

export interface PhotoGate {
  runner: ImageEmbeddingRunner;
  model: PhotoGateModel;
}

/** Score in (0, 1): near 1 for photos, near 0 for drawings, illustrations and screenshots. */
export async function photoLikeScore(pixels: Pixels, gate: PhotoGate): Promise<number> {
  const { runner, model: m } = gate;
  if (runner.id !== m.runnerId)
    throw new Error(`Gate ${m.id} belongs to ${m.runnerId}, but the runner is ${runner.id}`);
  const e = await runner.run(preprocessForClassifier(pixels, m.preprocess), m.preprocess.cropSize);
  if (e.length !== m.logistic.weights.length)
    throw new Error(
      `Gate ${m.id} expects ${m.logistic.weights.length} values, but the encoder returned ${e.length}`,
    );
  let norm = 0;
  for (const v of e) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return applyLogistic(
    m.logistic,
    Array.from(e, (v) => v / norm),
  ).raw;
}

export async function isPhotoLike(pixels: Pixels, gate: PhotoGate): Promise<boolean> {
  return (await photoLikeScore(pixels, gate)) >= gate.model.threshold;
}
