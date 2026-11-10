/**
 * Generalisation check for the Tier 0 text model: train on one kind of text, test on another.
 * In-domain numbers flatter any learned detector; this is the honest companion figure.
 */
import { TEXT_FEATURES, isLikelyEnglish, textFeatures, words } from '@isitreal/core';
import type { TextItem } from './dataset.js';
import { fitLogReg, predict } from './logreg.js';
import { auroc } from './metrics.js';

export interface CrossDomainRow {
  trainedOn: string;
  testedOn: string;
  n: number;
  auroc: number;
}

const domainOf = (i: TextItem) => i.subgroup.split('/')[0]!;
const vec = (t: string) => {
  const f = textFeatures(t);
  return TEXT_FEATURES.map((k) => f[k]);
};

export function crossDomain(items: readonly TextItem[], minWords: number): CrossDomainRow[] {
  const usable = items.filter((i) => words(i.text).length >= minWords && isLikelyEnglish(i.text));
  const domains = [...new Set(usable.map(domainOf))].sort();
  const rows: CrossDomainRow[] = [];
  for (const a of domains) {
    const train = usable.filter((i) => domainOf(i) === a);
    const m = fitLogReg(
      train.map((i) => vec(i.text)),
      train.map((i) => (i.truth === 'ai' ? 1 : 0)),
    );
    for (const b of domains) {
      if (a === b) continue;
      const test = usable.filter((i) => domainOf(i) === b);
      rows.push({
        trainedOn: a,
        testedOn: b,
        n: test.length,
        auroc: auroc(
          test.map((i) => ({ truth: i.truth, score: predict(m, vec(i.text)), subgroup: b })),
        ),
      });
    }
  }
  return rows;
}

export function crossDomainMarkdown(rows: readonly CrossDomainRow[]): string {
  return [
    '### Does the text-statistics model carry over to other kinds of text?',
    '',
    'Same features, trained on one domain and tested on another (AUROC; 0.5 = chance, 1 = perfect).',
    '',
    '| Trained on | Tested on | n | AUROC |',
    '|---|---|---|---|',
    ...rows.map((r) => `| ${r.trainedOn} | ${r.testedOn} | ${r.n} | ${r.auroc.toFixed(3)} |`),
    '',
  ].join('\n');
}
