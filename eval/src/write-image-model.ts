/**
 * Writes the calibration from eval/reference/image_calibrate.py into the core's model description.
 * Usage: tsx src/write-image-model.ts <calibration.json>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [calibrationPath] = process.argv.slice(2);
if (calibrationPath === undefined) throw new Error('usage: write-image-model <calibration.json>');
const cal = JSON.parse(readFileSync(calibrationPath, 'utf8')) as {
  model: string;
  sha256: string;
  n: number;
  calibration: number[];
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
// The calibration must come from the exact shipped file: compare checksums, not file names.
if (cal.sha256 !== model['sha256'])
  throw new Error(
    `calibration was computed with sha256 ${cal.sha256}, not ${String(model['sha256'])}`,
  );
model['calibration'] = [...cal.calibration].sort((a, b) => a - b);
model['calibratedOn'] =
  `${cal.n} real photos (Open Images V7 validation, calibration split), each scored as original, social copy (1080 px, JPEG 80) and copy of a copy (512 px, JPEG 60) with this exact file; the highest of the three is kept. ` +
  'Covers photos like these; other kinds of images (art, screenshots, modern phone photos) are not calibrated.';
writeFileSync(out, JSON.stringify(model, null, 2) + '\n');
console.log(`wrote ${cal.n} calibration scores into ${out}`);
