/**
 * Detects the AI labels that platforms themselves show next to content.
 *
 * Matching is done on SHORT visible strings and aria-labels only (label badges are short), so an
 * article that merely mentions "AI-generated" is not counted. Site markup changes often, so
 * patterns live in this one versioned table and are verified by the M0 provenance census.
 */

export const PLATFORM_LABELS_VERSION = '0.1.0';

export interface PlatformLabelRule {
  platform: string;
  /** Hostname suffixes this rule applies to. Empty = any site (generic, lower trust). */
  hosts: string[];
  /** Exact-ish label text, matched case-insensitively against the whole short string. */
  patterns: RegExp[];
}

export const PLATFORM_LABEL_RULES: PlatformLabelRule[] = [
  {
    platform: 'meta',
    hosts: ['facebook.com', 'instagram.com', 'threads.net', 'threads.com'],
    patterns: [/^ai info$/i, /^made with ai$/i, /^ai[- ]generated$/i],
  },
  {
    platform: 'youtube',
    hosts: ['youtube.com'],
    patterns: [/^altered or synthetic content$/i, /^how this content was made$/i],
  },
  {
    platform: 'tiktok',
    hosts: ['tiktok.com'],
    patterns: [/^creator labeled as ai-generated$/i, /^ai-generated$/i],
  },
  {
    platform: 'linkedin',
    hosts: ['linkedin.com'],
    patterns: [/^content credentials$/i],
  },
  {
    platform: 'generic',
    hosts: [],
    patterns: [/^ai[- ]generated( image| video| content)?$/i, /^generated (by|with) ai$/i],
  },
];

/** Strings longer than this are ignored: platform badges are short. */
export const MAX_LABEL_LENGTH = 60;

export interface PlatformLabelHit {
  platform: string;
  text: string;
}

export function matchPlatformLabels(
  hostname: string,
  strings: Iterable<string>,
): PlatformLabelHit[] {
  const host = hostname.toLowerCase();
  const rules = PLATFORM_LABEL_RULES.filter(
    (r) => r.hosts.length === 0 || r.hosts.some((h) => host === h || host.endsWith(`.${h}`)),
  );
  const hits: PlatformLabelHit[] = [];
  const seen = new Set<string>();
  for (const raw of strings) {
    const text = raw.replace(/\s+/g, ' ').trim();
    if (text.length === 0 || text.length > MAX_LABEL_LENGTH) continue;
    for (const rule of rules) {
      if (rule.patterns.some((p) => p.test(text))) {
        const key = `${rule.platform}|${text.toLowerCase()}`;
        if (!seen.has(key)) {
          seen.add(key);
          hits.push({ platform: rule.platform, text });
        }
        break;
      }
    }
  }
  return hits;
}
