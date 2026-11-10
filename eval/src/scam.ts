import { readFile } from 'node:fs/promises';
import { analyzeScam, type ScamRisk } from '@isitreal/core';
import { z } from 'zod';

export const ScamItemSchema = z.object({
  id: z.string().min(1),
  truth: z.enum(['scam', 'benign']),
  category: z.string().min(1),
  source: z.string().min(1),
  text: z.string(),
  pageHost: z.string().optional(),
});
export type ScamItem = z.infer<typeof ScamItemSchema>;

export async function loadScamJsonl(path: string): Promise<ScamItem[]> {
  const raw = await readFile(path, 'utf8');
  return raw
    .split('\n')
    .map((l, i) => ({ l: l.trim(), line: i + 1 }))
    .filter(({ l }) => l.length > 0 && !l.startsWith('//'))
    .map(({ l, line }) => {
      const r = ScamItemSchema.safeParse(JSON.parse(l));
      if (!r.success) throw new Error(`${path}:${line}: ${r.error.message}`);
      return r.data;
    });
}

/** "Flagged" = medium or high risk: what the UI shows as a warning. Low risk is a quiet note. */
export const isFlagged = (r: ScamRisk) => r === 'medium' || r === 'high';

export interface ScamReport {
  set: string;
  engine: string;
  nScam: number;
  nBenign: number;
  recall: number;
  falsePositiveRate: number;
  byCategory: { category: string; truth: string; n: number; flagged: number }[];
  misses: { id: string; risk: ScamRisk; score: number; rules: string[] }[];
  falseAlarms: { id: string; risk: ScamRisk; score: number; rules: string[] }[];
}

export function evaluateScam(set: string, engine: string, items: readonly ScamItem[]): ScamReport {
  const results = items.map((item) => {
    const input =
      item.pageHost === undefined
        ? { text: item.text }
        : { text: item.text, pageHost: item.pageHost };
    return { item, r: analyzeScam(input) };
  });
  const scam = results.filter((x) => x.item.truth === 'scam');
  const benign = results.filter((x) => x.item.truth === 'benign');
  const cats = new Map<string, { category: string; truth: string; n: number; flagged: number }>();
  for (const { item, r } of results) {
    const key = `${item.truth}|${item.category}`;
    const c = cats.get(key) ?? { category: item.category, truth: item.truth, n: 0, flagged: 0 };
    c.n++;
    if (isFlagged(r.risk)) c.flagged++;
    cats.set(key, c);
  }
  const brief = ({ item, r }: (typeof results)[number]) => ({
    id: item.id,
    risk: r.risk,
    score: r.score,
    rules: r.hits.map((h) => `${h.rule}: "${h.evidence}"`),
  });
  return {
    set,
    engine,
    nScam: scam.length,
    nBenign: benign.length,
    recall:
      scam.length === 0 ? Number.NaN : scam.filter((x) => isFlagged(x.r.risk)).length / scam.length,
    falsePositiveRate:
      benign.length === 0
        ? Number.NaN
        : benign.filter((x) => isFlagged(x.r.risk)).length / benign.length,
    byCategory: [...cats.values()].sort((a, b) =>
      (a.truth + a.category).localeCompare(b.truth + b.category),
    ),
    misses: scam.filter((x) => !isFlagged(x.r.risk)).map(brief),
    falseAlarms: benign.filter((x) => isFlagged(x.r.risk)).map(brief),
  };
}

const pct = (x: number) => (Number.isNaN(x) ? 'n/a' : `${(x * 100).toFixed(1)}%`);

export function scamToMarkdown(r: ScamReport): string {
  return [
    `## Scam rules on \`${r.set}\` (${r.engine})`,
    '',
    '| Metric | Value | Target (M1) |',
    '|---|---|---|',
    `| Scam items flagged (recall) | ${pct(r.recall)} of ${r.nScam} | >= 90% |`,
    `| Benign items flagged (false-positive rate) | ${pct(r.falsePositiveRate)} of ${r.nBenign} | < 5% |`,
    '',
    '| Truth | Category | n | Flagged |',
    '|---|---|---|---|',
    ...r.byCategory.map((c) => `| ${c.truth} | ${c.category} | ${c.n} | ${c.flagged} |`),
    '',
    `**Missed scams (${r.misses.length})**`,
    '',
    ...(r.misses.length === 0
      ? ['None.']
      : r.misses.map((m) => `- \`${m.id}\` risk=${m.risk} score=${m.score} ${m.rules.join('; ')}`)),
    '',
    `**False alarms (${r.falseAlarms.length})**`,
    '',
    ...(r.falseAlarms.length === 0
      ? ['None.']
      : r.falseAlarms.map(
          (m) => `- \`${m.id}\` risk=${m.risk} score=${m.score} ${m.rules.join('; ')}`,
        )),
    '',
  ].join('\n');
}
