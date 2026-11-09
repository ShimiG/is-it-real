import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DENY_LIST,
  MAX_EXAMPLES,
  emptyTally,
  isDenied,
  recordImage,
  recordLabels,
  recordPage,
  summary,
} from '../src/tally.js';

const clean = { format: 'jpeg' as const, c2pa: false, aiSourceTypes: [], generatorHints: [] };

describe('census tally', () => {
  it('counts pages, images and hits per site', () => {
    const t = emptyTally(new Date(0));
    recordPage(t, 'a.com', 2);
    recordImage(t, 'a.com', 'https://a.com/1.jpg', { kind: 'sniffed', result: clean });
    recordImage(t, 'a.com', 'https://a.com/2.jpg', {
      kind: 'sniffed',
      result: { ...clean, c2pa: true, aiSourceTypes: ['trainedAlgorithmicMedia'] },
    });
    recordImage(t, 'a.com', 'blob:x', { kind: 'unreadable' });
    recordLabels(t, 'a.com', 'https://a.com/p', [{ platform: 'meta', text: 'AI info' }]);
    expect(t).toMatchObject({
      pages: 1,
      videos: 2,
      images: { checked: 2, unreadable: 1, tooLarge: 0 },
      hits: { c2pa: 1, aiSourceType: 1, generator: 0, labels: { meta: 1 } },
      sites: { 'a.com': { pages: 1, hits: 2 } },
    });
    expect(summary(t)).toMatchObject({ imageMarkerRate: 1, labelHitsPerPage: 1 });
  });

  it('caps examples per kind', () => {
    const t = emptyTally();
    for (let i = 0; i < MAX_EXAMPLES + 5; i++)
      recordImage(t, 'a.com', `https://a.com/${i}.png`, {
        kind: 'sniffed',
        result: { ...clean, c2pa: true },
      });
    expect(t.examples['c2pa']).toHaveLength(MAX_EXAMPLES);
  });

  it('skips sensitive sites on the default never-scan list', () => {
    expect(isDenied('www.mybank.com', DEFAULT_DENY_LIST)).toBe(true);
    expect(isDenied('mail.google.com', DEFAULT_DENY_LIST)).toBe(true);
    expect(isDenied('www.youtube.com', DEFAULT_DENY_LIST)).toBe(false);
  });
});
