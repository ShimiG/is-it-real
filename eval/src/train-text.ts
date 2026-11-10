/**
 * Trains the Tier 0 text-statistics model and writes packages/core/src/text/text-stats.model.json.
 * Train split -> logistic weights; calib split (human only) -> conformal calibration scores.
 * The test split is never touched here; `pnpm eval` reports on it.
 */
import { writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEXT_FEATURES, isLikelyEnglish, textFeatures, words } from '@isitreal/core';
import { loadJsonl } from './dataset.js';
import { fitLogReg, predict } from './logreg.js';
import { splitOf } from './split.js';

const MIN_WORDS = 110;
const here = dirname(fileURLToPath(import.meta.url));
const items = await loadJsonl(join(here, '..', 'datasets', '.cache', 'fdgpt', 'text.jsonl'));
const usable = items.filter((i) => words(i.text).length >= MIN_WORDS && isLikelyEnglish(i.text));
const vec = (t: string) => {
  const f = textFeatures(t);
  return TEXT_FEATURES.map((k) => f[k]);
};

const train = usable.filter((i) => splitOf(i.group ?? i.id) === 'train');
const calibHuman = usable.filter(
  (i) => splitOf(i.group ?? i.id) === 'calib' && i.truth === 'human',
);

// Balance classes: there are two AI continuations per human passage.
const wHuman =
  train.filter((i) => i.truth === 'ai').length / train.filter((i) => i.truth === 'human').length;
const X: number[][] = [];
const y: number[] = [];
for (const i of train) {
  const reps = i.truth === 'human' ? Math.round(wHuman) : 1;
  for (let r = 0; r < reps; r++) {
    X.push(vec(i.text));
    y.push(i.truth === 'ai' ? 1 : 0);
  }
}
const m = fitLogReg(X, y);
const round = (x: number) => Number(x.toFixed(6));
const calibration = calibHuman.map((i) => round(predict(m, vec(i.text)))).sort((a, b) => a - b);

const model = {
  id: 'text.stats@0.1.0',
  features: [...TEXT_FEATURES],
  mean: m.mean.map(round),
  std: m.std.map(round),
  weights: m.weights.map(round),
  bias: round(m.bias),
  minWords: MIN_WORDS,
  calibration,
  trainedOn: `fast-detect-gpt@971b052 gpt3to4 (XSum news, WritingPrompts stories; GPT-3.5-turbo and GPT-4 continuations), English, >= ${MIN_WORDS} words. Train ${train.length} items, calibration ${calibHuman.length} human items. Not calibrated for other kinds of text.`,
};
const out = resolve(here, '..', '..', 'packages', 'core', 'src', 'text', 'text-stats.model.json');
await writeFile(out, JSON.stringify(model, null, 2) + '\n');
console.log(`train=${train.length} calibHuman=${calibHuman.length}`);
console.log(
  TEXT_FEATURES.map((k, j) => `${k.padEnd(22)} ${m.weights[j]!.toFixed(3)}`)
    .sort()
    .join('\n'),
);
console.log(`wrote ${out}`);
