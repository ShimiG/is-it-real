import { conformalScore } from '../calibration.js';
import type { ImageClassifierModel, ImageClassifierRunner } from '../image/classifier.js';
import { isPhotoLike, type PhotoGate } from '../image/photo-gate.js';
import { preprocessForClassifier } from '../image/preprocess.js';
import type { Pixels } from '../image/spectral.js';
import type { DetectorResult } from '../types.js';
import model from './video-frames.model.json' with { type: 'json' };

/**
 * Statistical video check (experimental): a few frames spread over the video are each measured
 * like a still image (photo gate, then the picture model), and the video gets ONE number, the
 * middle (median) of its frames' raw scores. That number is compared with the same number for
 * held-out real videos, so "Likely made with AI" flags at most about 1 in 100 real videos like
 * the calibration set (ADR-0006, ADR-0012).
 *
 * Frames that are not plain camera-style pictures (animation, title cards, text or graphics over
 * the picture) are left out by the gate; with too few frames left, the video is "not checked".
 */
export interface VideoFramesModel {
  id: string;
  /** The picture model and gate this calibration was computed with; others are refused. */
  imageModelId: string;
  gateId: string;
  /** How many frames a host samples, evenly spaced: frame k at (k + 0.5) / frames of the duration. */
  frames: number;
  /** At least this many frames must pass the gate, otherwise the video is not assessed. */
  minChecked: number;
  /** Median frame score of held-out real videos (worst of original and re-shared copy), ascending. */
  calibration: number[];
  calibratedOn: string;
}

export const VIDEO_FRAMES_MODEL = model as unknown as VideoFramesModel;

export interface VideoFrameCheck {
  gate: PhotoGate;
  runner: ImageClassifierRunner;
  imageModel: ImageClassifierModel;
  model: VideoFramesModel;
}

export function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export async function detectVideoFrames(
  frames: readonly Pixels[],
  check: VideoFrameCheck,
): Promise<DetectorResult> {
  const { gate, runner, imageModel, model: m } = check;
  if (imageModel.id !== m.imageModelId || gate.model.id !== m.gateId)
    throw new Error(
      `Calibration ${m.id} belongs to ${m.imageModelId} and ${m.gateId}, not ${imageModel.id} and ${gate.model.id}`,
    );
  if (runner.id !== imageModel.runnerId)
    throw new Error(`Model ${imageModel.id} belongs to ${imageModel.runnerId}, not ${runner.id}`);
  if (frames.length === 0)
    return { status: 'not_assessed', detector: m.id, reason: 'unreadable_media' };
  const usable = frames.filter((f) => Math.min(f.width, f.height) >= imageModel.minSide);
  if (usable.length === 0) return { status: 'not_assessed', detector: m.id, reason: 'too_short' };
  const scores: number[] = [];
  for (const frame of usable) {
    if (!(await isPhotoLike(frame, gate))) continue;
    scores.push(await runner.run(preprocessForClassifier(frame, imageModel), imageModel.cropSize));
  }
  if (scores.length < m.minChecked)
    return { status: 'not_assessed', detector: m.id, reason: 'video_not_plain_footage' };
  const raw = median(scores);
  return {
    status: 'assessed',
    signal: {
      detector: m.id,
      modality: 'video',
      kind: 'statistical',
      score: conformalScore(raw, m.calibration),
      reasons: ['video_frames_ai'],
      details: {
        raw: Number(raw.toFixed(4)),
        frames: frames.length,
        framesChecked: scores.length,
        calibrationSize: m.calibration.length,
      },
    },
  };
}
