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
});

describe('editDistance', () => {
  it('computes Levenshtein distance', () => {
    expect(editDistance('kitten', 'sitting')).toBe(3);
    expect(editDistance('', 'abc')).toBe(3);
  });
});
