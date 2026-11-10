/**
 * Builds the feature table that training and evaluation read: eval/features/text-features.v1.jsonl.
 * One row per text: Tier 0 statistics plus Tier 1 language-model features. Running the model over
 * ~6,500 texts takes a while, so the table is committed; it contains numbers only, no text.
 *
 *   tsx src/features.ts --shard 0/4     compute one shard (run shards in parallel)
 *   tsx src/features.ts --merge         merge shards into the committed table
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  LM_FEATURES,
  TEXT_FEATURES,
  isLikelyEnglish,
  lmFeatures,
  textFeatures,
  words,
} from '@isitreal/core';
import { GPT2_ZOO, loadGpt2 } from '@isitreal/lm-node';
import { loadJsonl } from './dataset.js';
import { splitOfItem, type Split } from './split.js';

export const MIN_WORDS = 110;
export const MAX_LM_TOKENS = 320;
export const FEATURES_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'features',
  'text-features.v1.jsonl',
);

/** Datasets in the table: downloaded ones live in datasets/.cache, our own in datasets/. */
const DATASETS: [string, 'cache' | 'repo'][] = [
  ['liang', 'cache'],
  ['ghostbuster', 'cache'],
  ['fdgpt', 'cache'],
  ['current-2026', 'repo'],
];
/** External checks: never trained or calibrated on. */
const TEST_ONLY = new Set(['fdgpt', 'current-2026']);

export interface FeatureRow {
  id: string;
  dataset: string;
  truth: 'ai' | 'human';
  subgroup: string;
  group: string;
  split: Split;
  words: number;
  english: boolean;
  /** Tier 0 features in TEXT_FEATURES order. */
  t0: number[];
  /** Tier 1 features in LM_FEATURES order; null when the text failed the length/language gate. */
  lm: number[] | null;
}

export function loadFeatureRows(path = FEATURES_FILE): FeatureRow[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.startsWith('{'))
    .map((l) => JSON.parse(l) as FeatureRow);
}

const round = (x: number) => Number(x.toFixed(5));

async function main() {
  const { values } = parseArgs({
    options: {
      shard: { type: 'string' },
      merge: { type: 'boolean', default: false },
      only: { type: 'string' },
    },
  });
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const cache = join(root, 'datasets', '.cache');
  const partDir = join(cache, 'features');
  mkdirSync(partDir, { recursive: true });

  if (values.merge) {
    const rows = readdirSync(partDir)
      .filter((f) => f.startsWith('part-'))
      .flatMap((f) => readFileSync(join(partDir, f), 'utf8').split('\n').filter(Boolean))
      .map((l) => JSON.parse(l) as FeatureRow)
      .sort((a, b) => a.id.localeCompare(b.id));
    mkdirSync(dirname(FEATURES_FILE), { recursive: true });
    const header = `// model=${GPT2_ZOO.id} maxTokens=${MAX_LM_TOKENS} minWords=${MIN_WORDS} t0=${TEXT_FEATURES.join(',')} lm=${LM_FEATURES.join(',')}\n`;
    writeFileSync(FEATURES_FILE, header + rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    console.log(`merged ${rows.length} rows -> ${FEATURES_FILE}`);
    return;
  }

  const [shard, shards] = (values.shard ?? '0/1').split('/').map(Number) as [number, number];
  const lm = await loadGpt2(join(cache, 'models', 'gpt2', GPT2_ZOO.file), { threads: 1 });
  const out = join(partDir, `part-${shard}.jsonl`);
  const done = new Set(
    existsSync(out)
      ? readFileSync(out, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((l) => (JSON.parse(l) as FeatureRow).id)
      : [],
  );
  let n = 0;
  for (const [dataset, where] of DATASETS) {
    if (values.only !== undefined && values.only !== dataset) continue;
    const dir = where === 'cache' ? cache : join(root, 'datasets');
    const items = await loadJsonl(join(dir, dataset, 'text.jsonl'));
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      if (i % shards !== shard || done.has(item.id)) continue;
      const nWords = words(item.text).length;
      const english = isLikelyEnglish(item.text);
      const f = textFeatures(item.text);
      let lmRow: number[] | null = null;
      if (nWords >= MIN_WORDS && english) {
        const feats = lmFeatures(await lm.run(item.text, MAX_LM_TOKENS));
        if (feats !== null) lmRow = LM_FEATURES.map((k) => round(feats[k]));
      }
      const row: FeatureRow = {
        id: item.id,
        dataset,
        truth: item.truth,
        subgroup: item.subgroup,
        group: item.group ?? item.id,
        split: TEST_ONLY.has(dataset) ? 'test' : splitOfItem(item),
        words: nWords,
        english,
        t0: TEXT_FEATURES.map((k) => round(f[k])),
        lm: lmRow,
      };
      writeFileSync(out, JSON.stringify(row) + '\n', { flag: 'a' });
      if (++n % 200 === 0) console.log(`shard ${shard}: ${n}`);
    }
  }
  console.log(`shard ${shard}: done, ${n} new rows`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
