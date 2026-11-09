import { DEFAULT_DENY_LIST, emptyTally, summary, type Tally } from './tally.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const pct = (x: number) => `${(x * 100).toFixed(2)}%`;

async function render() {
  const s = await chrome.storage.local.get(['tally', 'paused', 'denyList']);
  const t = (s.tally as Tally | undefined) ?? emptyTally();
  const sum = summary(t);
  $('since').textContent = `Counting since ${new Date(t.startedAt).toLocaleString()}`;
  const rows: [string, string | number][] = [
    ['Pages counted', t.pages],
    ['Pages skipped (never-scan list)', t.pagesSkipped],
    ['Images checked', t.images.checked],
    ['Images unreadable / too large', `${t.images.unreadable} / ${t.images.tooLarge}`],
    ['Videos seen', t.videos],
    ['Content Credentials (C2PA)', t.hits.c2pa],
    ['IPTC "made by AI" code', t.hits.aiSourceType],
    ['AI generator settings in file', t.hits.generator],
    ...Object.entries(t.hits.labels).map(
      ([p, n]) => [`Platform label: ${p}`, n] as [string, number],
    ),
    ['Images with any marker', pct(sum.imageMarkerRate)],
    ['Platform labels per page', sum.labelHitsPerPage.toFixed(3)],
  ];
  const table = $('stats');
  table.replaceChildren(
    ...rows.map(([k, v]) => {
      const tr = document.createElement('tr');
      const a = document.createElement('td');
      const b = document.createElement('td');
      a.textContent = k;
      b.textContent = String(v);
      tr.append(a, b);
      return tr;
    }),
  );
  $<HTMLInputElement>('paused').checked = s.paused === true;
  $<HTMLTextAreaElement>('deny').value = (
    Array.isArray(s.denyList) ? (s.denyList as string[]) : DEFAULT_DENY_LIST
  ).join('\n');
}

$('paused').addEventListener('change', async (e) => {
  await chrome.storage.local.set({ paused: (e.target as HTMLInputElement).checked });
});
$('save').addEventListener('click', async () => {
  const list = $<HTMLTextAreaElement>('deny')
    .value.split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  await chrome.storage.local.set({ denyList: list });
  await render();
});
$('export').addEventListener('click', async () => {
  const { tally } = await chrome.storage.local.get('tally');
  const blob = new Blob([JSON.stringify(tally ?? emptyTally(), null, 2)], {
    type: 'application/json',
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `provenance-census-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
});
$('reset').addEventListener('click', async () => {
  if (!confirm('Reset all counts?')) return;
  await chrome.storage.local.set({ tally: emptyTally() });
  await render();
});

void render();
