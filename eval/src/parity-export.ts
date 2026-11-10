/** Writes token ids and TypeScript criterion values for the Python parity check (eval/reference). */
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lmFeatures } from '@isitreal/core';
import { GPT2_ZOO, loadGpt2 } from '@isitreal/lm-node';
import { loadJsonl } from './dataset.js';
import { MAX_LM_TOKENS } from './features.js';

const cache = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'datasets', '.cache');
const lm = await loadGpt2(join(cache, 'models', 'gpt2', GPT2_ZOO.file));
const items = (await loadJsonl(join(cache, 'fdgpt', 'text.jsonl'))).filter(
  (i) => !i.subgroup.includes('pubmed'),
);
// Every 45th item: a spread of human, GPT-3.5 and GPT-4 texts from both domains.
const cases = [];
for (let i = 0; i < items.length && cases.length < 20; i += 45) {
  const out = await lm.run(items[i]!.text, MAX_LM_TOKENS);
  const f = lmFeatures(out);
  if (f === null) continue;
  cases.push({ id: items[i]!.id, tokenIds: Array.from(out.tokenIds), fdCriterion: f.fdCriterion });
}
const path = join(cache, 'parity.json');
writeFileSync(path, JSON.stringify(cases));
console.log(`wrote ${cases.length} cases to ${path}`);
