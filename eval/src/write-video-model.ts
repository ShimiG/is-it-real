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
import { SAMPLING_VERSIONS, evaluateVideoFrames, loadVideoScores } from './video-models.js';

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
const rule = {
  gateThreshold: PHOTO_GATE_MODEL.threshold,
  minChecked: Number(model['minChecked']),
};
const report = evaluateVideoFrames(rows, rule, 0.01, SAMPLING_VERSIONS.spread);
const watched = evaluateVideoFrames(rows, rule, 0.01, SAMPLING_VERSIONS.watched);
const mixOf = (r: typeof report) =>
  Object.entries(r.calibrationSources)
    .sort((a, b) => b[1] - a[1])
    .map(([s, c]) => `${c} ${s}`)
    .join(', ');
model['id'] = 'video.frames@0.2.0';
model['imageModelId'] = IMAGE_CLASSIFIER_MODEL.id;
model['gateId'] = PHOTO_GATE_MODEL.id;
model['calibration'] = report.calibration.map((v) => Number(v.toFixed(4)));
model['calibrationWatched'] = watched.calibration.map((v) => Number(v.toFixed(4)));
model['calibratedOn'] =
  `Non-AI videos from the calibration half. Each video's number is the median picture-model score of ${String(model['frames'])} frames that pass the photo gate, taken as the file is and as a re-shared copy (at most 480 px high, H.264 CRF 30); the higher of the two is kept. ` +
  `Video files (calibration): frames spread over the whole clip, ${report.calibrationSize} videos (${mixOf(report)}). ` +
  `Playing video (calibrationWatched): frames about a second apart from one place, ${watched.calibrationSize} videos (${mixOf(watched)}). ` +
  "Frames are the decoder's raw planes converted by the core's fixed rule (video/yuv.ts). " +
  'Scores come from the float32 copy of the picture model (largest difference to the shipped file seen: 0.07).';
writeFileSync(out, JSON.stringify(model, null, 2) + '\n');
console.log(
  `video files: ${report.calibrationSize} calibration numbers (${mixOf(report)}), raw cut-off ${report.cutoff.toFixed(3)}; ` +
    `playing video: ${watched.calibrationSize} (${mixOf(watched)}), raw cut-off ${watched.cutoff.toFixed(3)}`,
);
