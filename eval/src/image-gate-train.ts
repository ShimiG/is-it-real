/**
 * Trains the photo gate (photo-like vs drawing / illustration / screenshot) on CLIP image
 * embeddings (eval/datasets/.cache/clip-embeds.jsonl, written by eval/reference/image_embed.py)
 * and writes the weights into packages/core/src/image/photo-gate.model.json.
 * Also writes eval/features/image-gate.v1.jsonl: the gate score of every evaluation image and
 * version (numbers only), which `pnpm eval` reads. Training uses the calibration split only.
 */
import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { fitLogReg, predict } from './logreg.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const GATE_SCORES_FILE = join(root, 'features', 'image-gate.v1.jsonl');
/** Non-AI sources that are photographs (memes are photos with a caption). */
export const PHOTO_SOURCES = ['real', 'phone', 'cosplay', 'meme'];
/** Non-AI sources that are drawn, painted or rendered by software. */
export const GRAPHIC_SOURCES = ['cartoon', 'digital_art', 'sketch', 'screenshot'];
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
  model['id'] = 'image.photo-gate@0.1.0';
  model['logistic'] = {
    features: m.mean.map((_, i) => `e${i}`),
    mean: m.mean.map(round),
    std: m.std.map(round),
    weights: m.weights.map(round),
    bias: round(m.bias),
  };
  model['threshold'] = GATE_THRESHOLD;
  model['trainedOn'] =
    `${train.length} image versions (calibration split; original, social copy, copy of a copy): photos = Open Images, SPAQ phone photos, cosplay and stage photos, memes; graphics = human-made cartoons, digital art, sketches (Human-Art) and screenshots (ScreenSpot-v2).`;
  writeFileSync(out, JSON.stringify(model, null, 2) + '\n');
  writeFileSync(
    GATE_SCORES_FILE,
    `// gate=${String(model['id'])} threshold=${GATE_THRESHOLD}\n${scores
      .sort((a, b) => a.id.localeCompare(b.id) || a.view.localeCompare(b.view))
      .map((r) => JSON.stringify(r))
      .join('\n')}\n`,
  );
  console.log(`\nwrote ${out}\nwrote ${GATE_SCORES_FILE} (${scores.length} rows)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
