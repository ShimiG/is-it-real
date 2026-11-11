/**
 * Writes the video frame check's calibration into the core's model description
 * (packages/core/src/video/video-frames.model.json), from the committed score table.
 *
 * The table holds scores from the float32 copy of the picture model; the shipped file is float16
 * (largest difference seen: 0.07 on a raw scale of about -14 to +14).
 * Usage: tsx src/write-video-model.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IMAGE_CLASSIFIER_MODEL, PHOTO_GATE_MODEL } from '@isitreal/core';
import { evaluateVideoFrames, loadVideoScores } from './video-models.js';

const out = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'packages',
  'core',
  'src',
  'video',
  'video-frames.model.json',
);
const model = JSON.parse(readFileSync(out, 'utf8')) as Record<string, unknown>;
const rows = loadVideoScores();
if (rows.length === 0) throw new Error('no video score table: run eval/reference/video_eval.py');
const report = evaluateVideoFrames(rows, {
  gateThreshold: PHOTO_GATE_MODEL.threshold,
  minChecked: Number(model['minChecked']),
});
const mix = Object.entries(report.calibrationSources)
  .sort((a, b) => b[1] - a[1])
  .map(([s, c]) => `${c} ${s}`)
  .join(', ');
model['id'] = 'video.frames@0.2.0';
model['imageModelId'] = IMAGE_CLASSIFIER_MODEL.id;
model['gateId'] = PHOTO_GATE_MODEL.id;
model['calibration'] = report.calibration.map((v) => Number(v.toFixed(4)));
model['calibratedOn'] =
  `${report.calibrationSize} non-AI videos from the calibration half (${mix}). Each video's number is the median picture-model score of ${String(model['frames'])} frames that pass the photo gate. Every video was scored four ways: frames spread over the whole clip and frames about a second apart from one place (as when it plays in a browser), each as the file is and as a re-shared copy (at most 480 px high, H.264 CRF 30); the highest of the four is kept. ` +
  "Frames are the decoder's raw planes converted by the core's fixed rule (video/yuv.ts). " +
  'Scores come from the float32 copy of the picture model (largest difference to the shipped file seen: 0.07).';
writeFileSync(out, JSON.stringify(model, null, 2) + '\n');
console.log(
  `wrote ${report.calibrationSize} calibration numbers (${mix}); raw cut-off ${report.cutoff.toFixed(3)}`,
);
