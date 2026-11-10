/**
 * Downloads public evaluation datasets into eval/datasets/.cache (git-ignored).
 * Sources are pinned to exact commits so reports are reproducible. We link to data instead of
 * redistributing it (CONTRIBUTING rule 6). Evaluation tooling may use the network; the product may not.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
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
          subgroup: `fd-${domain}/${model}`,
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

/** Shallow-clone a public dataset repository into .cache/src (skipped when already there). */
function cloneRepo(name: string, url: string, commit: string): string {
  const dir = join(root, 'src', name);
  if (!existsSync(dir)) {
    mkdirSync(join(root, 'src'), { recursive: true });
    execFileSync('git', ['clone', '--quiet', '--depth', '1', url, dir], {
      stdio: 'inherit',
      env: { ...process.env, GIT_LFS_SKIP_SMUDGE: '1' },
    });
  }
  const head = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD']).toString().trim();
  if (head !== commit)
    console.warn(
      `warning: ${name} is at ${head.slice(0, 7)}, results were produced at ${commit.slice(0, 7)}`,
    );
  return dir;
}

/** Stable pseudo-random order, so samples are the same on every machine. */
function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
const sample = <T>(xs: T[], key: (x: T) => string, n: number) =>
  [...xs].sort((a, b) => fnv(key(a)) - fnv(key(b)) || key(a).localeCompare(key(b))).slice(0, n);
const wordCount = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

function txtFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.txt') && !f.includes('logprobs'))
    .map((f) => f.split('\\').join('/'))
    .sort();
}

const GB_COMMIT = '86ebd72590556a81622986fab736ab9227a948af';
const GB_DOMAINS: [string, string][] = [
  ['essay', 'essay'],
  ['reuter', 'news'],
  ['wp', 'stories'],
];

/**
 * Ghostbuster data (Verma et al., NAACL 2024; CC BY 3.0): student essays, Reuters news and
 * r/WritingPrompts stories, each with ChatGPT and Claude versions written for the same prompt,
 * plus non-native English writing and text rewritten by a "humanizer" tool.
 */
function buildGhostbuster() {
  const dir = cloneRepo(
    'ghostbuster-data',
    'https://github.com/vivek3141/ghostbuster-data',
    GB_COMMIT,
  );
  const source = (path: string) => `ghostbuster-data@${GB_COMMIT.slice(0, 7)} ${path} (CC BY 3.0)`;
  const read = (rel: string) => readFileSync(join(dir, rel), 'utf8').trim();
  const rows: object[] = [];
  for (const [folder, name] of GB_DOMAINS) {
    const ids = sample(txtFiles(join(dir, folder, 'human')), (f) => `${folder}/${f}`, 600);
    ids.forEach((f, i) => {
      const group = `gb-${folder}-${f}`;
      rows.push({
        id: `gb-${folder}-human-${f}`,
        group,
        modality: 'text',
        truth: 'human',
        subgroup: name,
        source: source(`${folder}/human`),
        text: read(`${folder}/human/${f}`),
      });
      // Half the prompts get the ChatGPT version, half the Claude version.
      const gen = i % 2 === 0 ? 'gpt' : 'claude';
      const rel = `${folder}/${gen}/${f}`;
      if (existsSync(join(dir, rel)))
        rows.push({
          id: `gb-${folder}-${gen}-${f}`,
          group,
          modality: 'text',
          truth: 'ai',
          subgroup: `${name}/${gen === 'gpt' ? 'chatgpt' : 'claude'}`,
          source: source(`${folder}/${gen}`),
          text: read(rel),
        });
    });
  }
  const other: [string, string, 'human' | 'ai', number, 'test' | undefined][] = [
    ['ets', 'nonnative/ets-essays', 'human', 400, undefined],
    ['pelic', 'nonnative/pelic-learners', 'human', 300, undefined],
    ['lang8', 'nonnative/lang8-learners', 'human', 300, undefined],
    ['bawe', 'student/bawe-academic', 'human', 300, undefined],
    ['undetectable', 'humanizer-rewritten', 'ai', 100, 'test'],
  ];
  for (const [folder, subgroup, truth, n, split] of other) {
    const files = txtFiles(join(dir, 'other', folder))
      .map((f) => ({ f, text: read(`other/${folder}/${f}`) }))
      .filter((x) => wordCount(x.text) >= 110);
    for (const { f, text } of sample(files, (x) => `${folder}/${x.f}`, n))
      rows.push({
        id: `gb-${folder}-${f}`,
        group: `gb-${folder}-${f}`,
        ...(split ? { split } : {}),
        modality: 'text',
        truth,
        subgroup,
        source: source(`other/${folder}`),
        text,
      });
  }
  mkdirSync(join(root, 'ghostbuster'), { recursive: true });
  writeFileSync(join(root, 'ghostbuster', 'text.jsonl'), jsonl(rows));
  console.log(`ghostbuster: ${rows.length} texts`);
}

const LIANG_COMMIT = '1d05ed8242d4694a0ed7b73a79c52be8864470f9';

/**
 * Liang et al. 2023, "GPT detectors are biased against non-native English writers" (MIT):
 * 91 TOEFL essays by non-native writers, 88 essays by US 8th-graders, 70 college essays.
 * All human, all TEST ONLY: this is the bias benchmark, never used for training or calibration.
 */
function buildLiang() {
  const dir = cloneRepo(
    'ChatGPT-Detector-Bias',
    'https://github.com/Weixin-Liang/ChatGPT-Detector-Bias',
    LIANG_COMMIT,
  );
  const sets: [string, string][] = [
    ['TOEFL_real_91', 'nonnative/toefl91'],
    ['HewlettStudentEssay_real_88', 'native/us-8th-grade'],
    ['CollegeEssay_real_70', 'native/college-essays'],
  ];
  const rows: object[] = [];
  for (const [folder, subgroup] of sets) {
    const docs = JSON.parse(
      readFileSync(join(dir, 'Data_and_Results', 'Human_Data', folder, 'data.json'), 'utf8'),
    ) as { document: string }[];
    docs.forEach((d, i) =>
      rows.push({
        id: `liang-${folder}-${i}`,
        split: 'test',
        modality: 'text',
        truth: 'human',
        subgroup,
        source: `ChatGPT-Detector-Bias@${LIANG_COMMIT.slice(0, 7)} ${folder} (MIT)`,
        text: d.document,
      }),
    );
  }
  mkdirSync(join(root, 'liang'), { recursive: true });
  writeFileSync(join(root, 'liang', 'text.jsonl'), jsonl(rows));
  console.log(`liang: ${rows.length} texts`);
}

await fetchSms();
await fetchFdgpt();
buildLiang();
// The Ghostbuster repository is about 2 GB; only fetch it when asked.
if (process.argv.includes('--full')) buildGhostbuster();
else console.log('ghostbuster: skipped (run with --full; about 2 GB)');
