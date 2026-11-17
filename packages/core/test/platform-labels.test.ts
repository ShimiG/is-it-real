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

  it('has no rule for unknown sites: their own words are a hint, not a platform label', () => {
    expect(matchPlatformLabels('news.example', ['  AI-generated\n image '])).toEqual([]);
    // Normalising whitespace still applies where a rule exists.
    expect(matchPlatformLabels('www.facebook.com', ['  AI\n info '])).toEqual([
      { platform: 'meta', text: 'AI info' },
    ]);
  });

  it("knows Meta's label names, in English and in Hebrew", () => {
    // Reported from real use: a Facebook reel with the label, on an account set to Hebrew.
    const seen = [
      'תוכן שנוצר באמצעות AI',
      'תווית AI נוספה לתוכן הזה על ידי Mavo',
      'סיוע בזיהוי תוכן של AI',
      'מידע נוסף על זיהוי תוכן שנוצר על ידי AI',
    ];
    expect(matchPlatformLabels('www.facebook.com', seen).map((h) => h.text)).toEqual([
      'תוכן שנוצר באמצעות AI',
      'תווית AI נוספה לתוכן הזה על ידי Mavo',
    ]);
    for (const label of ['AI info', 'AI content', 'AI creator', 'AI-generated profile'])
      expect(matchPlatformLabels('www.instagram.com', [label]), label).toHaveLength(1);
    expect(
      matchPlatformLabels('www.facebook.com', ['An AI label was added to this content by Mavo']),
    ).toHaveLength(1);
    // Help links and ordinary sentences with "AI" in them are not the label.
    expect(matchPlatformLabels('www.facebook.com', ['AI', 'כלי AI חדש', 'Meta AI'])).toEqual([]);
  });

  it('matches the YouTube disclosure', () => {
    expect(matchPlatformLabels('m.youtube.com', ['Altered or synthetic content'])).toHaveLength(1);
    // The wording in YouTube's help page of 2026 ("How this content was made" disclosures).
    expect(
      matchPlatformLabels('www.youtube.com', [
        'How this content was made',
        'Made with AI',
        'Info from Google',
      ]),
    ).toEqual([{ platform: 'youtube', text: 'Made with AI' }]);
  });

  it("does not take YouTube's section heading or camera disclosure for an AI label", () => {
    // The same heading is shown over "Captured with a camera": it says nothing about AI.
    expect(
      matchPlatformLabels('www.youtube.com', [
        'How this content was made',
        'Captured with a camera',
        'Info from Sony',
      ]),
    ).toEqual([]);
    // A recommended video's title that starts with the same words is not the label.
    expect(matchPlatformLabels('www.youtube.com', ['Made with AI: 10 short films'])).toEqual([]);
  });
});
