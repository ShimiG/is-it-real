import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadJsonl } from './dataset.js';
import { DETECTORS } from './detectors.js';
import { evaluate, toMarkdown } from './run.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const { values } = parseArgs({
  options: {
    dataset: { type: 'string', default: 'toy' },
    alpha: { type: 'string', default: '0.01' },
  },
});

const dataset = values.dataset;
const alpha = Number(values.alpha);
const items = await loadJsonl(join(root, 'datasets', dataset, 'text.jsonl'));
const reports = DETECTORS.map((d) => evaluate(d, dataset, items, alpha));

const outDir = join(root, 'reports', dataset);
await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, 'report.json'), JSON.stringify(reports, null, 2) + '\n');
const md = toMarkdown(reports);
await writeFile(join(outDir, 'report.md'), md);
console.log(md);
console.log(`Wrote ${join('eval', 'reports', dataset)}/report.{md,json}`);
