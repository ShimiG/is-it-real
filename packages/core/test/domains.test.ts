import { describe, expect, it } from 'vitest';
import {
  checkLinkMismatch,
  checkLookalike,
  editDistance,
  extractHosts,
  registrableDomain,
} from '../src/index.js';

describe('registrableDomain', () => {
  it('handles common and two-level suffixes', () => {
    expect(registrableDomain('www.paypal.com')).toBe('paypal.com');
    expect(registrableDomain('secure.amazon.co.uk')).toBe('amazon.co.uk');
    expect(registrableDomain('localhost')).toBe('localhost');
  });
});

describe('extractHosts', () => {
  it('finds domains with and without a scheme, but not sentence joins', () => {
    expect(
      extractHosts('Go to https://usps-help.top/x or netflix-billing.com now.Call us'),
    ).toEqual(['usps-help.top', 'netflix-billing.com']);
  });

  it('does not read software names like "Node.js" as addresses', () => {
    // Reported from real use: a GitHub page's "Node.js" link to nodejs.org was a "mismatch".
    expect(extractHosts('Requires Node.js 20 and Next.js; see nodejs.org or bit.ly/x')).toEqual([
      'nodejs.org',
      'bit.ly',
    ]);
  });
});

describe('checkLookalike', () => {
  it('accepts the real brand domains', () => {
    expect(checkLookalike('www.paypal.com')).toBeNull();
    expect(checkLookalike('smile.amazon.co.uk')).toBeNull();
    expect(checkLookalike('www.irs.gov')).toBeNull();
  });

  it('flags brand names inside foreign domains', () => {
    expect(checkLookalike('appleid-verify-support.com')).toMatchObject({
      brand: 'Apple',
      why: 'brand_in_foreign_domain',
    });
    expect(checkLookalike('usps-redelivery.top')).toMatchObject({ brand: 'USPS' });
  });

  it('flags one-letter and digit-swap misspellings', () => {
    expect(checkLookalike('paypa1.com')).toMatchObject({
      brand: 'PayPal',
      why: 'near_miss_spelling',
    });
    expect(checkLookalike('arnazon.com')).toMatchObject({ brand: 'Amazon' });
  });

  it('does not flag genuinely different brands that look similar', () => {
    expect(checkLookalike('icicibank.com')).toBeNull();
    expect(checkLookalike('upsidefoods.com')).toBeNull();
  });

  it('flags punycode hosts', () => {
    expect(checkLookalike('xn--pypal-4ve.com')).toMatchObject({ why: 'punycode' });
  });
});

describe('checkLinkMismatch', () => {
  it('reports shown vs real destination', () => {
    expect(checkLinkMismatch('www.chase.com', 'https://chase-login.help/x')).toBe(
      'www.chase.com -> chase-login.help',
    );
    expect(checkLinkMismatch('Log in to PayPal', 'https://pp-secure.net')).toBe(
      'PayPal -> pp-secure.net',
    );
    expect(checkLinkMismatch('Open PayPal', 'https://www.paypal.com/signin')).toBeNull();
  });

  it('follows a site\'s own "you are leaving" link to the real destination', () => {
    // Reported from real use: an address in a YouTube description goes through youtube.com.
    const viaYouTube =
      'https://www.youtube.com/redirect?event=video_description&redir_token=abc&q=https%3A%2F%2Fgoa.hu%2Ftour';
    expect(checkLinkMismatch('goa.hu', viaYouTube, 'www.youtube.com')).toBeNull();
    expect(checkLinkMismatch('goa.hu/tour', viaYouTube)).toBeNull();
    // The written address and the destination inside the redirect still have to agree.
    expect(checkLinkMismatch('www.chase.com', viaYouTube, 'www.youtube.com')).toBe(
      'www.chase.com -> goa.hu',
    );
    expect(
      checkLinkMismatch(
        'example.org',
        'https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.org%2F',
        'www.facebook.com',
      ),
    ).toBeNull();
  });

  it("does not treat a page's own buttons and links as a mismatch", () => {
    // Reported from real use: a "Facebook" share button on a news site that leads to the site itself.
    expect(
      checkLinkMismatch(
        'Facebook',
        'https://www.theguardian.com/share?to=facebook',
        'www.theguardian.com',
      ),
    ).toBeNull();
    // On a page, a button that only names a brand is not judged, wherever it goes.
    expect(
      checkLinkMismatch(
        'Share on Facebook',
        'https://sharing.example.net/fb',
        'www.theguardian.com',
      ),
    ).toBeNull();
    // A platform's own short links, on that platform.
    expect(checkLinkMismatch('example.org/article', 'https://t.co/AbC123', 'x.com')).toBeNull();
    // In a message there is no page: the same short link with a written address is a mismatch.
    expect(checkLinkMismatch('example.org/article', 'https://t.co/AbC123')).toBe(
      'example.org -> t.co',
    );
  });

  it("still catches a fake login page that writes a brand's address over a link to itself", () => {
    expect(
      checkLinkMismatch(
        'https://www.paypal.com/login',
        'https://secure-check.example/steal',
        'secure-check.example',
      ),
    ).toBe('www.paypal.com -> secure-check.example');
    // And a written address that leads to a third site.
    expect(
      checkLinkMismatch('www.mybank-online.com', 'https://collect.example/x', 'news.example.org'),
    ).toBe('www.mybank-online.com -> collect.example');
  });

  it('does not treat a software name as a written address', () => {
    expect(checkLinkMismatch('Node.js', 'https://nodejs.org/', 'github.com')).toBeNull();
    expect(checkLinkMismatch('Node.js', 'https://nodejs.org/')).toBeNull();
    // A real written address on the same site still has to match where the link goes.
    expect(checkLinkMismatch('www.paypal.com', 'https://paypal-help.example/x', 'github.com')).toBe(
      'www.paypal.com -> paypal-help.example',
    );
  });
});

describe('editDistance', () => {
  it('computes Levenshtein distance', () => {
    expect(editDistance('kitten', 'sitting')).toBe(3);
    expect(editDistance('', 'abc')).toBe(3);
  });
});
