import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MAX_IMAGES, checkPageData, type EngineCapabilities } from '../src/engine/check.js';
import type { PageData } from '../src/messages.js';

const fixtures = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'packages',
  'c2pa-node',
  'test',
  'fixtures',
);

const page = (over: Partial<PageData> = {}): PageData => ({
  url: 'https://www.facebook.com/some.post',
  title: 'A post',
  text: '',
  links: [],
  images: [],
  videos: [],
  pageLabels: [],
  skippedImages: 0,
  ...over,
});

const caps = (over: Partial<EngineCapabilities> = {}): EngineCapabilities => ({
  fetchBytes: async (url) => {
    if (url.includes('missing')) throw new Error('HTTP 404');
    return new Uint8Array(await readFile(join(fixtures, 'plain.jpg')));
  },
  c2pa: async () => null,
  imageCheck: async () => null,
  ...over,
});

describe('checkPageData', () => {
  it('reports scam risk with the words found, and advice', async () => {
    const r = await checkPageData(
      page({
        text: 'Your account is locked. Pay the release fee with Google Play gift cards today and do not tell anyone.',
      }),
      caps(),
    );
    expect(r.scam.risk).toBe('high');
    expect(r.scam.reasons.length).toBeGreaterThan(0);
    expect(r.scam.reasons[0]!.evidence).toBeTruthy();
    expect(r.scam.advice.length).toBeGreaterThan(0);
    expect(r.items[0]).toMatchObject({ kind: 'text', outcome: 'not_assessed' });
  });

  it('counts a label next to a picture even when the picture cannot be loaded', async () => {
    const r = await checkPageData(
      page({
        images: [
          { url: 'https://cdn.example/a.jpg', labels: ['Our agent'] },
          { url: 'https://cdn.example/missing.jpg', labels: ['AI info'] },
        ],
      }),
      caps(),
    );
    expect(r.items.map((i) => `${i.kind}:${i.outcome}`)).toEqual([
      'image:no_clear_signs',
      'image:verified_ai',
    ]);
    expect(r.items[1]!.reasons.map((x) => x.code)).toEqual(['platform_label_ai']);
    expect(r.items[1]!.note).toContain('could not load');
    expect(r.checks).toEqual({ contentCredentials: false, pictureModel: false });
  });

  it('checks at most twelve pictures and says how many were left out', async () => {
    const images = Array.from({ length: MAX_IMAGES + 3 }, (_, i) => ({
      url: `https://cdn.example/${i}.jpg`,
      labels: [],
    }));
    const seen: [number, number][] = [];
    const r = await checkPageData(
      page({ images, skippedImages: 2 }),
      caps({ onProgress: (done, total) => seen.push([done, total]) }),
    );
    expect(r.items.filter((i) => i.kind === 'image')).toHaveLength(MAX_IMAGES);
    expect(r.notChecked).toBe(5);
    expect(seen.at(-1)).toEqual([MAX_IMAGES + 1, MAX_IMAGES + 1]);
  });

  it('reports the label a site shows for the whole page', async () => {
    const r = await checkPageData(page({ pageLabels: ['AI info', 'Like'] }), caps());
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ kind: 'page', outcome: 'verified_ai' });
  });

  it('does not look for site labels on pages without a web address', async () => {
    const r = await checkPageData(
      page({ url: 'file:///C:/a.html', pageLabels: ['AI info'] }),
      caps(),
    );
    expect(r.items).toHaveLength(0);
  });
});
