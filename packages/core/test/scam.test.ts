import { describe, expect, it } from 'vitest';
import { analyzeScam } from '../src/index.js';

const rules = (text: string) =>
  analyzeScam({ text })
    .hits.map((h) => h.rule)
    .sort();

describe('analyzeScam', () => {
  it('flags a classic gift-card demand as high risk with plain reasons', () => {
    const r = analyzeScam({
      text: 'This is the IRS. You owe back taxes and a warrant has been issued for your arrest. Pay today with Google Play gift cards and read me the numbers. Do not tell your family.',
    });
    expect(r.risk).toBe('high');
    expect(r.reasons).toEqual(
      expect.arrayContaining([
        'scam_unusual_payment',
        'scam_threat',
        'scam_secrecy',
        'scam_impersonation',
      ]),
    );
    expect(r.signals.every((s) => s.kind === 'scam_rule' && s.score <= 1)).toBe(true);
  });

  it('does not flag a store selling gift cards', () => {
    expect(
      analyzeScam({ text: 'Buy a $50 gift card and get a $10 bonus card. Offer ends tonight.' })
        .risk,
    ).toBe('low');
  });

  it('ignores warnings that say what a bank will never do', () => {
    const r = analyzeScam({
      text: 'We will never ask you to pay with gift cards or to read back a security code. Never share your PIN.',
    });
    expect(r.risk).toBe('none');
  });

  it('ignores sentences that describe scams instead of making demands', () => {
    const r = analyzeScam({
      text: 'Scammers may say your account is locked and insist you pay with gift cards. Hang up and call your bank.',
    });
    expect(r.risk).toBe('none');
  });

  it('only treats threats aimed at the reader as threats', () => {
    expect(rules('Police arrested a man downtown on Tuesday.')).toEqual([]);
    expect(rules('There is a warrant for your arrest.')).toEqual(['threat']);
  });

  it('catches a grandparent scam spread over several sentences', () => {
    expect(
      rules(
        "Grandma, it's me. I was in an accident and I'm in jail. I need money for bail, please send it today.",
      ),
    ).toContain('family_emergency');
  });

  it('does not treat a normal family message as an emergency', () => {
    expect(
      analyzeScam({ text: "Hi Grandma, it's me! Practice ran late, I'll be there at 7." }).risk,
    ).toBe('none');
  });

  it('spots a look-alike bank domain in the text', () => {
    const r = analyzeScam({
      text: 'Verify your account at https://wellsfargo-secure-verify.com/login today.',
    });
    expect(r.hits.map((h) => h.rule)).toContain('lookalike_domain');
  });

  it('spots a link whose text and destination differ', () => {
    const r = analyzeScam({
      text: 'Sign in to view your statement.',
      links: [{ text: 'www.paypal.com', href: 'https://paypal.account-check.ru/login' }],
    });
    expect(r.hits.map((h) => h.rule)).toEqual(
      expect.arrayContaining(['link_mismatch', 'lookalike_domain']),
    );
  });

  it('stacks independent too-good-to-be-true claims', () => {
    const one = analyzeScam({ text: 'You have won a prize.' }).score;
    const two = analyzeScam({
      text: 'You have won a prize. Guaranteed returns of 30% a month, zero risk.',
    }).score;
    expect(two).toBeGreaterThan(one);
  });

  it('understands texting shorthand', () => {
    expect(rules('U have won a cash prize! Claim ur prize now.')).toContain('too_good');
  });

  it('returns no hits for ordinary text', () => {
    expect(
      analyzeScam({ text: 'Preheat the oven to 350 degrees and bake for 35 minutes.' }),
    ).toMatchObject({
      risk: 'none',
      score: 0,
      hits: [],
    });
  });
});
