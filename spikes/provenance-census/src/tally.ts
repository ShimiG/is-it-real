import type { PlatformLabelHit } from '@isitreal/core/platform-labels';
import type { SniffResult } from '@isitreal/core/provenance/sniff';

/** Aggregated census counts. Stored in chrome.storage.local only. */
export interface Tally {
  version: 1;
  startedAt: string;
  pages: number;
  pagesSkipped: number;
  images: { checked: number; unreadable: number; tooLarge: number };
  videos: number;
  hits: {
    c2pa: number;
    aiSourceType: number;
    generator: number;
    /** Platform-label hits by platform (counted once per page per label text). */
    labels: Record<string, number>;
  };
  /** Pages and hits per site (hostname only, no paths). */
  sites: Record<string, { pages: number; hits: number }>;
  /** A few example URLs per hit type so the owner can verify hits by hand. */
  examples: Record<string, { url: string; detail: string }[]>;
}

export const MAX_EXAMPLES = 25;

export const DEFAULT_DENY_LIST = [
  'bank',
  'paypal',
  'mail.',
  'outlook.',
  'webmail',
  'health',
  'clinic',
  'hospital',
  'pharmacy',
  'insurance',
  'accounts.google.',
  'login.',
  'signin.',
];

export function emptyTally(now: Date = new Date()): Tally {
  return {
    version: 1,
    startedAt: now.toISOString(),
    pages: 0,
    pagesSkipped: 0,
    images: { checked: 0, unreadable: 0, tooLarge: 0 },
    videos: 0,
    hits: { c2pa: 0, aiSourceType: 0, generator: 0, labels: {} },
    sites: {},
    examples: {},
  };
}

export function isDenied(host: string, denyList: readonly string[]): boolean {
  const h = host.toLowerCase();
  return denyList.some((p) => p.trim().length > 0 && h.includes(p.trim().toLowerCase()));
}

function site(t: Tally, host: string) {
  return (t.sites[host] ??= { pages: 0, hits: 0 });
}

function example(t: Tally, kind: string, url: string, detail: string) {
  const list = (t.examples[kind] ??= []);
  if (list.length < MAX_EXAMPLES && !list.some((e) => e.url === url)) list.push({ url, detail });
}

export function recordPage(t: Tally, host: string, videos: number): void {
  t.pages++;
  t.videos += videos;
  site(t, host).pages++;
}

export function recordLabels(t: Tally, host: string, pageUrl: string, hits: PlatformLabelHit[]) {
  for (const h of hits) {
    t.hits.labels[h.platform] = (t.hits.labels[h.platform] ?? 0) + 1;
    site(t, host).hits++;
    example(t, `label:${h.platform}`, pageUrl, h.text);
  }
}

export type ImageOutcome =
  { kind: 'sniffed'; result: SniffResult } | { kind: 'unreadable' } | { kind: 'too_large' };

export function recordImage(t: Tally, host: string, url: string, o: ImageOutcome): void {
  if (o.kind === 'unreadable') {
    t.images.unreadable++;
    return;
  }
  if (o.kind === 'too_large') {
    t.images.tooLarge++;
    return;
  }
  t.images.checked++;
  const r = o.result;
  let hit = false;
  if (r.c2pa) {
    t.hits.c2pa++;
    example(t, 'c2pa', url, r.format);
    hit = true;
  }
  if (r.aiSourceTypes.length > 0) {
    t.hits.aiSourceType++;
    example(t, 'aiSourceType', url, r.aiSourceTypes.join(','));
    hit = true;
  }
  if (r.generatorHints.length > 0) {
    t.hits.generator++;
    example(t, 'generator', url, r.generatorHints.join(','));
    hit = true;
  }
  if (hit) site(t, host).hits++;
}

/** Share of checked images / pages with any marker: the number the M0 decision depends on. */
export function summary(t: Tally) {
  const labelHits = Object.values(t.hits.labels).reduce((a, b) => a + b, 0);
  const anyImageHit = t.hits.c2pa + t.hits.aiSourceType + t.hits.generator;
  return {
    pages: t.pages,
    imagesChecked: t.images.checked,
    imageMarkerRate: t.images.checked === 0 ? 0 : anyImageHit / t.images.checked,
    labelHitsPerPage: t.pages === 0 ? 0 : labelHits / t.pages,
  };
}
