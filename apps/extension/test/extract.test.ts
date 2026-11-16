import { describe, expect, it } from 'vitest';
import { isVideoPage } from '../src/content/extract.js';

const at = (address: string) => {
  const url = new URL(address);
  return { hostname: url.hostname, pathname: url.pathname };
};

describe('isVideoPage', () => {
  it("knows a single video's own page on the big video sites", () => {
    for (const address of [
      // Reported from real use.
      'https://www.facebook.com/reel/1138576875316387',
      'https://www.instagram.com/reels/DfLuTAeIJgK/',
      'https://www.instagram.com/p/DfnikpBRWtP/',
      'https://www.youtube.com/shorts/VVR1-KB5JIA',
      'https://www.youtube.com/watch?v=abc',
      'https://www.tiktok.com/@someone/video/7301',
      'https://x.com/someone/status/123',
    ])
      expect(isVideoPage(at(address)), address).toBe(true);
  });

  it("does not treat feeds, profiles and other sites as one video's page", () => {
    for (const address of [
      'https://www.facebook.com/',
      'https://www.facebook.com/somepage',
      'https://www.instagram.com/',
      'https://www.instagram.com/someone/',
      'https://www.youtube.com/',
      'https://www.youtube.com/results?search_query=x',
      'https://news.example/watch/reel/1',
    ])
      expect(isVideoPage(at(address)), address).toBe(false);
  });
});
