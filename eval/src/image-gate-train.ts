/**
 * Trains the photo gate (photo-like vs drawing / illustration / screenshot) on CLIP image
 * embeddings (eval/datasets/.cache/clip-embeds.jsonl, written by eval/reference/image_embed.py)
 * and writes the weights into packages/core/src/image/photo-gate.model.json.
 * Also writes eval/features/image-gate.v1.jsonl: the gate score of every evaluation image and
 * version (numbers only), which `pnpm eval` reads. Training uses the calibration split only.
 *
 * When eval/datasets/.cache/video-raw.jsonl exists (written by eval/reference/video_eval.py), it
 * also writes eval/features/video-scores.v1.jsonl: per video and version, the gate score and the
 * picture-model score of each sampled frame, with the motion statistics. The gate is trained on
 * still images only; video frames never influence it.
 */
import { createReadStream, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { fitLogReg, predict } from './logreg.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const GATE_SCORES_FILE = join(root, 'features', 'image-gate.v1.jsonl');
const VIDEO_RAW_FILE = join(root, 'datasets', '.cache', 'video-raw.jsonl');
const VIDEO_SCORES_FILE = join(root, 'features', 'video-scores.v1.jsonl');
/** Non-AI sources that are plain photographs. */
export const PHOTO_SOURCES = ['real', 'phone', 'cosplay'];
/**
 * Non-AI sources that are drawn, painted or rendered by software, plus memes (pictures with text
 * added on top). Memes were first counted as photos: the picture model then wrongly flagged 7 of
 * 108 of them, far above the 1% rule, so they are kept away from it as well.
 */
export const GRAPHIC_SOURCES = ['cartoon', 'digital_art', 'sketch', 'screenshot', 'meme'];
export const GATE_THRESHOLD = 0.5;

interface EmbedRow {
  id: string;
  source: string;
  truth: 'ai' | 'real';
  split: 'calib' | 'test';
  view: string;
  e: number[];
}

async function main() {
  const rows: EmbedRow[] = [];
  const rl = createInterface({
    input: createReadStream(join(root, 'datasets', '.cache', 'clip-embeds.jsonl')),
  });
  for await (const line of rl) if (line.startsWith('{')) rows.push(JSON.parse(line) as EmbedRow);

  const labelled = (r: EmbedRow) =>
    PHOTO_SOURCES.includes(r.source) || GRAPHIC_SOURCES.includes(r.source);
  const y = (r: EmbedRow) => (PHOTO_SOURCES.includes(r.source) ? 1 : 0);
  const train = rows.filter((r) => r.split === 'calib' && labelled(r));
  const nPhoto = train.filter((r) => y(r) === 1).length;
  const nGraphic = train.length - nPhoto;
  const m = fitLogReg(
    train.map((r) => r.e),
    train.map(y),
    {
      weights: train.map((r) => (y(r) === 1 ? nGraphic / nPhoto : 1)),
      l2: 0.05,
      epochs: 300,
      lr: 0.3,
    },
  );
  console.log(`trained on ${train.length} image versions (${nPhoto} photo, ${nGraphic} graphic)`);

  const scores = rows.map((r) => ({
    id: r.id,
    source: r.source,
    truth: r.truth,
    split: r.split,
    view: r.view,
    gate: Number(predict(m, r.e).toFixed(4)),
  }));
  const thresholds = [0.2, 0.3, 0.5, 0.7, 0.8];
  for (const split of ['calib', 'test'] as const) {
    console.log(`\nshare passing the gate (${split} split, all versions), by threshold:`);
    console.log('source'.padEnd(14) + thresholds.map((t) => String(t).padStart(7)).join(''));
    for (const s of [...new Set(scores.map((r) => r.source))].sort()) {
      const rs = scores.filter((r) => r.source === s && r.split === split);
      if (rs.length === 0) continue;
      console.log(
        s.padEnd(14) +
          thresholds
            .map((t) =>
              `${((100 * rs.filter((r) => r.gate >= t).length) / rs.length).toFixed(0)}%`.padStart(
                7,
              ),
            )
            .join(''),
      );
    }
  }

  const round = (x: number) => Number(x.toFixed(6));
  const out = resolve(root, '..', 'packages', 'core', 'src', 'image', 'photo-gate.model.json');
  const model = JSON.parse(readFileSync(out, 'utf8')) as Record<string, unknown>;
  model['id'] = 'image.photo-gate@0.2.0';
  model['logistic'] = {
    features: m.mean.map((_, i) => `e${i}`),
    mean: m.mean.map(round),
    std: m.std.map(round),
    weights: m.weights.map(round),
    bias: round(m.bias),
  };
  model['threshold'] = GATE_THRESHOLD;
  model['trainedOn'] =
    `${train.length} image versions (calibration split; original, social copy, copy of a copy): plain photos = Open Images, SPAQ phone photos, cosplay and stage photos; not plain photos = human-made cartoons, digital art, sketches (Human-Art), screenshots (ScreenSpot-v2) and memes (pictures with added text).`;
  writeFileSync(out, JSON.stringify(model, null, 2) + '\n');
  writeFileSync(
    GATE_SCORES_FILE,
    `// gate=${String(model['id'])} threshold=${GATE_THRESHOLD}\n${scores
      .sort((a, b) => a.id.localeCompare(b.id) || a.view.localeCompare(b.view))
      .map((r) => JSON.stringify(r))
      .join('\n')}\n`,
  );
  console.log(`\nwrote ${out}\nwrote ${GATE_SCORES_FILE} (${scores.length} rows)`);

  // Video frames: apply the trained gate to the frames' encoder outputs.
  if (existsSync(VIDEO_RAW_FILE)) {
    const lines: string[] = [];
    const raw = createInterface({ input: createReadStream(VIDEO_RAW_FILE) });
    for await (const line of raw) {
      if (!line.startsWith('{')) continue;
      const { emb, ...rest } = JSON.parse(line) as {
        emb?: number[][];
        id: string;
        version: string;
      };
      lines.push(
        JSON.stringify({
          ...rest,
          ...(emb === undefined ? {} : { gate: emb.map((e) => Number(predict(m, e).toFixed(4))) }),
        }),
      );
    }
    lines.sort();
    writeFileSync(VIDEO_SCORES_FILE, `// gate=${String(model['id'])}\n${lines.join('\n')}\n`);
    console.log(`wrote ${VIDEO_SCORES_FILE} (${lines.length} rows)`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
