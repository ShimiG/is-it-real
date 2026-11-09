import { describe, expect, it } from 'vitest';
import { matchPlatformLabels } from '../src/index.js';

describe('matchPlatformLabels', () => {
  it('matches a platform badge on its own site', () => {
    expect(matchPlatformLabels('www.instagram.com', ['AI info', 'Like'])).toEqual([
      { platform: 'meta', text: 'AI info' },
    ]);
  });

  it('does not apply a platform rule on another site', () => {
    expect(matchPlatformLabels('example.com', ['AI info'])).toEqual([]);
  });

  it('ignores long strings that merely mention AI', () => {
    const sentence = 'Experts say AI-generated content is spreading fast across social networks';
    expect(matchPlatformLabels('www.youtube.com', [sentence])).toEqual([]);
  });

  it('matches the generic label anywhere, normalising whitespace', () => {
    expect(matchPlatformLabels('news.example', ['  AI-generated\n image '])).toEqual([
      { platform: 'generic', text: 'AI-generated image' },
    ]);
  });

  it('matches the YouTube disclosure', () => {
    expect(matchPlatformLabels('m.youtube.com', ['Altered or synthetic content'])).toHaveLength(1);
  });
});
