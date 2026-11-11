/**
 * Writes the picture model's calibration into the core's model description.
 *
 * Calibration set: every non-AI image of the calibration split that passes the photo gate in at
 * least one version (the images the model is allowed to judge). Each contributes its highest score
 * across its versions. Scores come from the committed score table (fp32 copy of the model); the
 * high-scoring images, which decide the cut-off, are replaced by scores from the exact shipped
 * file (eval/reference/image_calibrate.py), and the script refuses to run if any are missing.
 *
 * Usage: tsx src/write-image-model.ts <calibration-by-id.json>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PHOTO_GATE_MODEL } from '@isitreal/core';
import { GATE_SCORES_FILE } from './image-gate-train.js';
import { loadGateScores, loadImageScores } from './image-models.js';

const TABLE_MODEL = 'tf-low-quality';
/** Images within this distance below the cut-off must have been scored with the shipped file. */
const EXACT_MARGIN = 1;

const [exactPath] = process.argv.slice(2);
if (exactPath === undefined) throw new Error('usage: write-image-model <calibration-by-id.json>');
const exact = JSON.parse(readFileSync(exactPath, 'utf8')) as {
  sha256: string;
  byId: Record<string, number>;
};
const out = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'packages',
  'core',
  'src',
  'image',
  'models',
  'commfor-low-quality.model.json',
);
const model = JSON.parse(readFileSync(out, 'utf8')) as Record<string, unknown>;
// The exact scores must come from the shipped file: compare checksums, not file names.
if (exact.sha256 !== model['sha256'])
  throw new Error(`exact scores are for sha256 ${exact.sha256}, not ${String(model['sha256'])}`);

const gate = loadGateScores(GATE_SCORES_FILE, PHOTO_GATE_MODEL.threshold);
if (gate === null) throw new Error(`${GATE_SCORES_FILE} not found: run gate:train first`);
const worst = new Map<string, number>();
const sources = new Map<string, string>();
const passing = new Set<string>();
for (const r of loadImageScores()) {
  const score = r.scores[TABLE_MODEL];
  if (r.truth !== 'real' || r.split !== 'calib' || score === undefined) continue;
  worst.set(r.id, Math.max(worst.get(r.id) ?? -Infinity, score));
  sources.set(r.id, r.source);
  if ((gate.scores.get(`${r.id}|${r.view}`) ?? 0) >= gate.threshold) passing.add(r.id);
}
const ids = [...passing].sort();
const scores = ids.map((id) => exact.byId[id] ?? worst.get(id)!);
const sorted = [...scores].sort((a, b) => a - b);
// The lowest raw score that reaches a conformal score of 0.99.
const n = sorted.length;
const cutoff = sorted[Math.min(n - 1, Math.ceil(0.99 * (n + 1)) - 1)]!;
const inexact = ids.filter(
  (id) => exact.byId[id] === undefined && worst.get(id)! >= cutoff - EXACT_MARGIN,
);
if (inexact.length > 0)
  throw new Error(
    `${inexact.length} images near the cut-off (${cutoff.toFixed(2)}) were not scored with the shipped file, e.g. ${inexact.slice(0, 3).join(', ')}`,
  );

const bySource = new Map<string, number>();
for (const id of ids) bySource.set(sources.get(id)!, (bySource.get(sources.get(id)!) ?? 0) + 1);
const mix = [...bySource.entries()]
  .sort((a, b) => b[1] - a[1])
  .map(([s, c]) => `${c} ${s}`)
  .join(', ');
model['calibration'] = sorted.map((v) => Number(v.toFixed(5)));
model['calibratedOn'] =
  `${n} non-AI images that pass the photo gate (${PHOTO_GATE_MODEL.id}) from the calibration split (${mix}). ` +
  'Each was scored as original, social copy (1080 px, JPEG 80) and copy of a copy (512 px, JPEG 60); the highest of the three is kept. ' +
  `Scores within ${EXACT_MARGIN} of the cut-off and above come from this exact file, the rest from its fp32 copy (largest difference seen: 0.07).`;
writeFileSync(out, JSON.stringify(model, null, 2) + '\n');
console.log(`wrote ${n} calibration scores (${mix}); cut-off ${cutoff.toFixed(3)}`);
