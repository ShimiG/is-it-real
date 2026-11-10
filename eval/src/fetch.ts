/**
 * Downloads public evaluation datasets into eval/datasets/.cache (git-ignored).
 * Sources are pinned to exact commits so reports are reproducible. We link to data instead of
 * redistributing it (CONTRIBUTING rule 6). Evaluation tooling may use the network; the product may not.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'datasets', '.cache');

const SMS_URL =
  'https://raw.githubusercontent.com/justmarkham/pycon-2016-tutorial/5339710562cc46c4a32a369d63f1e8751a18a54e/data/sms.tsv';
const SMS_SOURCE =
  'SMS Spam Collection v.1 (Almeida & Gomez Hidalgo, 2011; CC BY 4.0 via UCI), mirror justmarkham/pycon-2016-tutorial@5339710';

const FDGPT_COMMIT = '971b05202bac2bb504d60c0ac0812fea7a8f7c82';
const FDGPT_BASE = `https://raw.githubusercontent.com/baoguangsheng/fast-detect-gpt/${FDGPT_COMMIT}/exp_gpt3to4/data`;
const FDGPT_DOMAINS = ['xsum', 'writing', 'pubmed'] as const;
const FDGPT_MODELS = ['gpt-3.5-turbo', 'gpt-4'] as const;

async function get(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

const jsonl = (rows: object[]) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

async function fetchSms() {
  const tsv = await get(SMS_URL);
  const ham: object[] = [];
  const spam: object[] = [];
  tsv.split('\n').forEach((line, i) => {
    const tab = line.indexOf('\t');
    if (tab < 0) return;
    const label = line.slice(0, tab).trim();
    const text = line.slice(tab + 1).trim();
    const row = { id: `sms-${i}`, category: `sms_${label}`, source: SMS_SOURCE, text };
    if (label === 'ham') ham.push({ ...row, truth: 'benign' });
    else if (label === 'spam') spam.push({ ...row, truth: 'scam' });
  });
  await mkdir(join(root, 'sms'), { recursive: true });
  await writeFile(join(root, 'sms', 'ham.jsonl'), jsonl(ham));
  await writeFile(join(root, 'sms', 'spam.jsonl'), jsonl(spam));
  console.log(`sms: ${ham.length} ham, ${spam.length} spam`);
}

/**
 * Fast-DetectGPT "gpt3to4" data (MIT): 150 human passages per domain (XSum news, WritingPrompts
 * stories, PubMed answers) and continuations by GPT-3.5-turbo and GPT-4 from the same prefixes.
 */
async function fetchFdgpt() {
  const rows: object[] = [];
  const seenHuman = new Set<string>();
  for (const domain of FDGPT_DOMAINS) {
    for (const model of FDGPT_MODELS) {
      const data = JSON.parse(await get(`${FDGPT_BASE}/${domain}_${model}.raw_data.json`)) as {
        original: string[];
        sampled: string[];
      };
      const source = `fast-detect-gpt@${FDGPT_COMMIT.slice(0, 7)} exp_gpt3to4/${domain}_${model} (MIT)`;
      data.original.forEach((text, i) => {
        const id = `fd-${domain}-h-${i}`;
        if (seenHuman.has(id)) return;
        seenHuman.add(id);
        rows.push({
          id,
          group: `${domain}-${i}`,
          modality: 'text',
          truth: 'human',
          subgroup: domain,
          source,
          text,
        });
      });
      data.sampled.forEach((text, i) => {
        rows.push({
          id: `fd-${domain}-${model}-${i}`,
          // Same group as the human passage it continues, so both land in the same split.
          group: `${domain}-${i}`,
          modality: 'text',
          truth: 'ai',
          subgroup: `${domain}/${model}`,
          source,
          text,
        });
      });
    }
  }
  await mkdir(join(root, 'fdgpt'), { recursive: true });
  await writeFile(join(root, 'fdgpt', 'text.jsonl'), jsonl(rows));
  console.log(`fdgpt: ${rows.length} texts`);
}

await fetchSms();
await fetchFdgpt();
