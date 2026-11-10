/**
 * Trains the shipped text models from the feature table and writes them into packages/core:
 *   text-stats.model.json     Tier 0 (no model needed at run time)
 *   text-ensemble.model.json  Tier 0 + language-model features (needs the local model)
 * The test split is never read here; `pnpm eval` reports on it.
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GPT2_ZOO } from '@isitreal/lm-node';
import { MAX_LM_TOKENS, MIN_WORDS, loadFeatureRows } from './features.js';
import { fitAll, usable } from './text-models.js';

const rows = loadFeatureRows();
const coreDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'packages',
  'core',
  'src',
  'text',
);
const round = (x: number) => Number(x.toFixed(6));
const ok = rows.filter(usable);
const nTrain = ok.filter((r) => r.split === 'train').length;
const data = `Ghostbuster data@86ebd72 (student essays, Reuters news, WritingPrompts stories; ChatGPT and Claude; plus non-native English writing: ETS essays, PELIC, Lang-8, and BAWE student writing). English, >= ${MIN_WORDS} words. Train ${nTrain} texts`;

for (const f of fitAll(rows)) {
  if (f.logreg === null) continue;
  const base = {
    id: f.spec.id,
    features: f.spec.features,
    mean: f.logreg.mean.map(round),
    std: f.logreg.std.map(round),
    weights: f.logreg.weights.map(round),
    bias: round(f.logreg.bias),
    minWords: MIN_WORDS,
    calibration: f.calibration.map(round),
    trainedOn: `${data}, calibration ${f.calibration.length} human texts. Not calibrated for other kinds of text.`,
  };
  if (f.spec.id.startsWith('text.stats')) {
    const model = { ...base, features: f.spec.features.map((n) => n.slice(3)) };
    writeFileSync(resolve(coreDir, 'text-stats.model.json'), JSON.stringify(model, null, 2) + '\n');
    console.log(`wrote text-stats.model.json (${f.calibration.length} calibration scores)`);
  } else if (f.spec.id.startsWith('text.ensemble')) {
    const model = { ...base, lmId: GPT2_ZOO.id, maxTokens: MAX_LM_TOKENS };
    writeFileSync(
      resolve(coreDir, 'text-ensemble.model.json'),
      JSON.stringify(model, null, 2) + '\n',
    );
    console.log(`wrote text-ensemble.model.json (${f.calibration.length} calibration scores)`);
    console.log(
      f.spec.features
        .map((n, j) => ({ n, w: f.logreg!.weights[j]! }))
        .sort((a, b) => Math.abs(b.w) - Math.abs(a.w))
        .slice(0, 12)
        .map((x) => `  ${x.n.padEnd(24)} ${x.w.toFixed(3)}`)
        .join('\n'),
    );
  }
}
