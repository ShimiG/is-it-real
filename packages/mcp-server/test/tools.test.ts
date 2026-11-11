import { describe, expect, it } from 'vitest';
import { checkImageTool, checkPageTool, checkTextTool, type Capabilities } from '../src/tools.js';

const noC2pa: Capabilities = { c2pa: async () => null, lm: null };
const enc = (s: string) => new TextEncoder().encode(s);
const dataJpeg = (extra: string) =>
  `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, ...enc(extra)]).toString('base64')}`;
const AI_XMP = '<x:xmpmeta>digitalsourcetype/trainedAlgorithmicMedia</x:xmpmeta>';

describe('check tools', () => {
  it('puts the scam warning and advice first', async () => {
    const r = await checkTextTool(
      {
        text: 'This is the IRS. Pay the fine today with Google Play gift cards and read me the codes. Do not tell your family.',
      },
      noC2pa,
    );
    expect(r.scam?.risk).toBe('high');
    expect(r.scam?.advice.length).toBeGreaterThan(0);
    expect(r.summary[0]).toMatch(/^Scam check: Warning/);
    expect(r.items[0]).toMatchObject({
      kind: 'text',
      outcome: 'not_assessed',
      title: 'Not checked',
    });
    expect(r.how_to_report).toMatch(/Never say content is "real"/);
  });

  it('checks images from data links and numbers them in the summary', async () => {
    const r = await checkPageTool(
      {
        page_url: 'https://example.com/post',
        images: [{ url: dataJpeg(AI_XMP) }, { url: dataJpeg('') }],
      },
      noC2pa,
    );
    expect(r.items.map((i) => i.outcome)).toEqual(['verified_ai', 'no_clear_signs']);
    expect(r.summary.filter((l) => /^Image \d/.test(l)).map((l) => l.slice(0, 7))).toEqual([
      'Image 1',
      'Image 2',
    ]);
    expect(r.items[0]!.note).toMatch(/Content Credentials could not be checked/);
    expect(r.checks_available).toEqual({ content_credentials: false, deep_text_check: false });
  });

  it('still uses a platform label when the image cannot be fetched', async () => {
    const r = await checkImageTool(
      {
        url: 'http://127.0.0.1/x.jpg',
        nearby_labels: ['AI info'],
        page_url: 'https://www.instagram.com/p/1',
      },
      noC2pa,
    );
    expect(r.items[0]).toMatchObject({
      outcome: 'verified_ai',
      reasons: [{ code: 'platform_label_ai' }],
    });
    expect(r.items[0]!.note).toMatch(/private or local network/);
  });

  it('reports a page-level platform label', async () => {
    const r = await checkPageTool(
      {
        page_url: 'https://www.youtube.com/watch?v=1',
        page_labels: ['Altered or synthetic content'],
      },
      noC2pa,
    );
    expect(r.items).toEqual([expect.objectContaining({ kind: 'page', outcome: 'verified_ai' })]);
  });

  it('never tells the user that content is real, human or safe', async () => {
    const r = await checkPageTool(
      {
        page_url: 'https://example.com',
        text: 'Preheat the oven and bake for 35 minutes.',
        images: [{ url: dataJpeg('') }],
      },
      noC2pa,
    );
    expect(r.summary.join('\n')).not.toMatch(/\b(is|looks) (real|human|genuine|safe)\b/i);
  });
});
