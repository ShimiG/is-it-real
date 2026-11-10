/**
 * Domain helpers for impersonation checks: URL extraction, registrable domain, brand look-alikes.
 * Pure string logic, no network (ADR-0003).
 */

export interface Brand {
  name: string;
  /** Tokens that, when found in a host label, suggest the host claims to be this brand. */
  tokens: string[];
  /** Registrable domains the brand really uses. */
  domains: string[];
}

export const BRANDS: Brand[] = [
  { name: 'PayPal', tokens: ['paypal'], domains: ['paypal.com', 'paypal.me'] },
  {
    name: 'Amazon',
    tokens: ['amazon', 'amzn'],
    domains: [
      'amazon.com',
      'amazon.co.uk',
      'amazon.ca',
      'amazon.de',
      'amazon.com.au',
      'amzn.to',
      'amazon.in',
    ],
  },
  {
    name: 'Apple',
    tokens: ['apple', 'appleid', 'icloud', 'itunes'],
    domains: ['apple.com', 'icloud.com'],
  },
  {
    name: 'Microsoft',
    tokens: ['microsoft', 'windows', 'office365', 'outlook'],
    domains: ['microsoft.com', 'live.com', 'outlook.com', 'office.com', 'windows.com'],
  },
  {
    name: 'Google',
    tokens: ['google', 'gmail'],
    domains: ['google.com', 'gmail.com', 'youtube.com'],
  },
  { name: 'Netflix', tokens: ['netflix'], domains: ['netflix.com'] },
  { name: 'Wells Fargo', tokens: ['wellsfargo'], domains: ['wellsfargo.com'] },
  { name: 'Chase', tokens: ['chase'], domains: ['chase.com'] },
  { name: 'Bank of America', tokens: ['bankofamerica', 'bofa'], domains: ['bankofamerica.com'] },
  { name: 'Citi', tokens: ['citibank'], domains: ['citi.com', 'citibank.com'] },
  { name: 'USPS', tokens: ['usps'], domains: ['usps.com'] },
  { name: 'UPS', tokens: ['ups'], domains: ['ups.com'] },
  { name: 'FedEx', tokens: ['fedex'], domains: ['fedex.com'] },
  { name: 'DHL', tokens: ['dhl'], domains: ['dhl.com', 'dhl.de'] },
  { name: 'Royal Mail', tokens: ['royalmail'], domains: ['royalmail.com'] },
  {
    name: 'E-ZPass',
    tokens: ['ezpass', 'e-zpass'],
    domains: [
      'e-zpassny.com',
      'ezpassnj.com',
      'ezpassva.com',
      'ezpassmd.com',
      'e-zpassiag.com',
      'ezpassde.com',
      'ezpassma.com',
      'ezpass.com',
    ],
  },
  { name: 'SunPass', tokens: ['sunpass'], domains: ['sunpass.com'] },
  { name: 'IRS', tokens: ['irs'], domains: ['irs.gov'] },
  { name: 'Social Security', tokens: ['ssa', 'socialsecurity'], domains: ['ssa.gov'] },
  { name: 'Medicare', tokens: ['medicare'], domains: ['medicare.gov', 'cms.gov'] },
  { name: 'Facebook', tokens: ['facebook'], domains: ['facebook.com', 'fb.com'] },
  { name: 'Instagram', tokens: ['instagram'], domains: ['instagram.com'] },
  { name: 'WhatsApp', tokens: ['whatsapp'], domains: ['whatsapp.com'] },
];

/** Two-level public suffixes we see in practice. A full PSL is overkill for these checks. */
const TWO_LEVEL_SUFFIXES = new Set([
  'co.uk',
  'org.uk',
  'gov.uk',
  'ac.uk',
  'com.au',
  'net.au',
  'org.au',
  'co.il',
  'org.il',
  'gov.il',
  'co.jp',
  'com.br',
  'co.nz',
  'co.za',
  'com.mx',
  'co.in',
  'com.sg',
  'com.tr',
]);

export function registrableDomain(host: string): string {
  const labels = host.toLowerCase().replace(/\.$/, '').split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  const lastTwo = labels.slice(-2).join('.');
  return TWO_LEVEL_SUFFIXES.has(lastTwo) ? labels.slice(-3).join('.') : lastTwo;
}

const URL_RE =
  /\b(?:https?:\/\/)?((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,24}|xn--[a-z0-9-]+))(?::\d+)?(?:\/[^\s"'<>)]*)?/gi;

/** Hosts mentioned in free text ("visit paypal-secure.com/login"). Bare words like "Medicare" don't count. */
export function extractHosts(text: string): string[] {
  const hosts = new Set<string>();
  for (const m of text.matchAll(URL_RE)) {
    const host = m[1]!.toLowerCase();
    const tld = host.split('.').pop()!;
    // Avoid "e.g", "U.S" and sentence joins like "today.Call": require a plausible TLD.
    if (!/^(xn--[a-z0-9-]+|[a-z]{2,24})$/.test(tld) || COMMON_WORD_TLDS.has(tld)) continue;
    hosts.add(host);
  }
  return [...hosts];
}

/** Things that look like TLDs but are usually sentence fragments ("now.Call", "Mr.Smith"). */
const COMMON_WORD_TLDS = new Set(['call', 'please', 'you', 'the', 'and', 'smith', 'it', 'we', 'i']);

export const SUSPICIOUS_TLDS = new Set([
  'top',
  'xyz',
  'info',
  'online',
  'click',
  'link',
  'live',
  'shop',
  'site',
  'icu',
  'buzz',
  'rest',
  'cam',
  'work',
  'support',
]);

export interface LookalikeHit {
  host: string;
  brand: string;
  why: 'brand_in_foreign_domain' | 'near_miss_spelling' | 'punycode';
}

const HOMOGLYPHS: [RegExp, string][] = [
  [/0/g, 'o'],
  [/1/g, 'l'],
  [/3/g, 'e'],
  [/5/g, 's'],
  [/rn/g, 'm'],
  [/vv/g, 'w'],
];

function deHomoglyph(s: string): string {
  return HOMOGLYPHS.reduce((acc, [re, to]) => acc.replace(re, to), s);
}

/** Damerau-free Levenshtein distance, small strings only. */
export function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [
    i,
    ...Array<number>(b.length).fill(0),
  ]);
  for (let j = 1; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return dp[a.length]![b.length]!;
}

/** Does this host pretend to belong to a known brand it doesn't belong to? */
export function checkLookalike(host: string): LookalikeHit | null {
  const h = host.toLowerCase();
  const reg = registrableDomain(h);
  if (h.split('.').some((l) => l.startsWith('xn--')))
    return { host: h, brand: 'unknown', why: 'punycode' };
  const labels = h.split(/[.-]/).filter(Boolean);
  const regLabel = deHomoglyph(reg.split('.')[0]!.replace(/-/g, ''));
  for (const brand of BRANDS) {
    if (brand.domains.includes(reg)) continue;
    const claims = brand.tokens.some((t) => {
      const tok = t.replace(/-/g, '');
      return labels.some((l) => (tok.length >= 5 ? l.includes(tok) : l === tok));
    });
    if (claims) return { host: h, brand: brand.name, why: 'brand_in_foreign_domain' };
    for (const t of brand.tokens) {
      const tok = t.replace(/-/g, '');
      if (tok.length < 5) continue;
      const d = editDistance(regLabel, tok);
      // One edit at most: real brands are often a couple of letters apart (icici vs citi).
      // Distance 0 here means a digit or letter-pair swap (paypa1, arnazon), since the brand's
      // real domains were skipped above.
      if (d <= 1) return { host: h, brand: brand.name, why: 'near_miss_spelling' };
    }
  }
  return null;
}

/** Link whose visible text names a different site (or brand) than where it really goes. */
export function checkLinkMismatch(linkText: string, href: string): string | null {
  let target: string;
  try {
    target = registrableDomain(new URL(href).hostname);
  } catch {
    return null;
  }
  const shown = extractHosts(linkText)[0];
  if (shown !== undefined && registrableDomain(shown) !== target) return `${shown} -> ${target}`;
  const text = linkText.toLowerCase();
  for (const brand of BRANDS) {
    const named = new RegExp(`\\b${brand.name.toLowerCase().replace(/\s+/g, '\\s*')}\\b`).test(
      text,
    );
    if (named && !brand.domains.includes(target)) return `${brand.name} -> ${target}`;
  }
  return null;
}
