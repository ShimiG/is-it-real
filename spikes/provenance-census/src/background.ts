import { sniffImage } from '@isitreal/core/provenance/sniff';
import type { PlatformLabelHit } from '@isitreal/core/platform-labels';
import {
  DEFAULT_DENY_LIST,
  emptyTally,
  isDenied,
  recordImage,
  recordLabels,
  recordPage,
  type ImageOutcome,
  type Tally,
} from './tally.js';

const MAX_BYTES = 15 * 1024 * 1024;

interface PageMessage {
  type: 'census:page';
  host: string;
  url: string;
  newPage: boolean;
  videos: number;
  images: string[];
  labels: PlatformLabelHit[];
}

interface Settings {
  paused: boolean;
  denyList: string[];
}

async function settings(): Promise<Settings> {
  const s = await chrome.storage.local.get(['paused', 'denyList']);
  return {
    paused: s.paused === true,
    denyList: Array.isArray(s.denyList) ? (s.denyList as string[]) : DEFAULT_DENY_LIST,
  };
}

// Serialise read-modify-write updates so concurrent messages do not lose counts.
let queue: Promise<unknown> = Promise.resolve();
function update(fn: (t: Tally) => void): Promise<void> {
  const next = queue.then(async () => {
    const { tally } = await chrome.storage.local.get('tally');
    const t = (tally as Tally | undefined) ?? emptyTally();
    fn(t);
    await chrome.storage.local.set({ tally: t });
  });
  queue = next.catch(() => undefined);
  return next;
}

const seenImages = new Set<string>();

async function inspect(url: string): Promise<ImageOutcome> {
  if (!/^(https?|data):/.test(url)) return { kind: 'unreadable' };
  try {
    const res = await fetch(url, { credentials: 'omit', cache: 'force-cache' });
    if (!res.ok) return { kind: 'unreadable' };
    const len = Number(res.headers.get('content-length') ?? '0');
    if (len > MAX_BYTES) return { kind: 'too_large' };
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) return { kind: 'too_large' };
    return { kind: 'sniffed', result: sniffImage(buf) };
  } catch {
    return { kind: 'unreadable' };
  }
}

async function onPage(m: PageMessage) {
  const s = await settings();
  if (s.paused) return;
  if (isDenied(m.host, s.denyList)) {
    if (m.newPage) await update((t) => void t.pagesSkipped++);
    return;
  }
  await update((t) => {
    if (m.newPage) recordPage(t, m.host, m.videos);
    recordLabels(t, m.host, m.url, m.labels);
  });
  for (const url of m.images) {
    if (seenImages.has(url)) continue;
    seenImages.add(url);
    const outcome = await inspect(url);
    await update((t) => recordImage(t, m.host, url, outcome));
  }
}

chrome.runtime.onMessage.addListener((msg: unknown) => {
  if ((msg as PageMessage | undefined)?.type === 'census:page') void onPage(msg as PageMessage);
  return false;
});
