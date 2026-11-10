import { describe, expect, it } from 'vitest';
import { PageReportSchema, checkImage, checkPage, type C2paReader } from '../src/index.js';

const enc = (s: string) => new TextEncoder().encode(s);
const jpeg = (extra = '') => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, ...enc(extra)]);
const aiXmp = '<x:xmpmeta>digitalsourcetype/trainedAlgorithmicMedia</x:xmpmeta>';

describe('checkImage', () => {
  it('uses the platform label shown next to an image', async () => {
    const v = await checkImage(
      { bytes: jpeg(), nearbyLabels: ['AI info', 'Like', 'Share'] },
      { hostname: 'www.instagram.com' },
    );
    expect(v).toMatchObject({
      outcome: 'verified_ai',
      reasons: ['platform_label_ai'],
      modality: 'image',
    });
  });

  it('ignores the same words on a site where they are not a platform label', async () => {
    const v = await checkImage(
      { bytes: jpeg(), nearbyLabels: ['AI info'] },
      { hostname: 'example.com' },
    );
    expect(v.outcome).toBe('no_clear_signs');
  });

  it('a platform label counts even when the file cannot be read', async () => {
    const v = await checkImage(
      { bytes: enc('not an image'), nearbyLabels: ['AI-generated'] },
      { hostname: 'news.example' },
    );
    expect(v.outcome).toBe('verified_ai');
  });

  it('passes the file to the C2PA reader with the right type', async () => {
    const seen: string[] = [];
    const c2pa: C2paReader = { read: async (_b, mime) => (seen.push(mime), null) };
    await checkImage({ bytes: jpeg() }, { c2pa });
    expect(seen).toEqual(['image/jpeg']);
  });
});

describe('checkPage', () => {
  it('reports scam risk first, then text, images and page labels', async () => {
    const report = await checkPage({
      text: 'Your account is locked. Pay the release fee with Google Play gift cards today and do not tell anyone.',
      pageHost: 'www.facebook.com',
      images: [{ bytes: jpeg(aiXmp) }, { bytes: jpeg() }],
      pageLabels: ['Made with AI'],
    });
    expect(PageReportSchema.safeParse(report).success).toBe(true);
    expect(report.scamRisk).toBe('high');
    expect(report.items.map((i) => `${i.modality}:${i.outcome}`)).toEqual([
      'text:not_assessed',
      'image:verified_ai',
      'image:no_clear_signs',
      'page:verified_ai',
    ]);
  });

  it('handles an empty page', async () => {
    expect(await checkPage({ text: '' })).toMatchObject({ scamRisk: 'none', items: [] });
  });
});
