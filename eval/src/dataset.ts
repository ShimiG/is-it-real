import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { Truth } from './metrics.js';

export const TextItemSchema = z.object({
  id: z.string().min(1),
  /** Items sharing a group (a passage and its AI continuation) always land in the same split. */
  group: z.string().optional(),
  modality: z.literal('text'),
  truth: z.enum(['ai', 'human']),
  subgroup: z.string().min(1),
  /** Where the item came from (dataset name, licence, generator model). Required for honesty. */
  source: z.string().min(1),
  text: z.string(),
});
export type TextItem = z.infer<typeof TextItemSchema> & { truth: Truth };

export async function loadJsonl(path: string): Promise<TextItem[]> {
  const raw = await readFile(path, 'utf8');
  return raw
    .split('\n')
    .map((l, i) => ({ l: l.trim(), line: i + 1 }))
    .filter(({ l }) => l.length > 0 && !l.startsWith('//'))
    .map(({ l, line }) => {
      const parsed = TextItemSchema.safeParse(JSON.parse(l));
      if (!parsed.success) throw new Error(`${path}:${line}: ${parsed.error.message}`);
      return parsed.data;
    });
}
