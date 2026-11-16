/**
 * Detects the AI labels that platforms themselves show next to content.
 *
 * Matching is done on SHORT visible strings and aria-labels only (label badges are short), so an
 * article that merely mentions "AI-generated" is not counted. Site markup changes often, so
 * patterns live in this one versioned table and are verified by the M0 provenance census.
 */

export const PLATFORM_LABELS_VERSION = '0.2.0';

export interface PlatformLabelRule {
  platform: string;
  /** Hostname suffixes this rule applies to. */
  hosts: string[];
  /** Exact-ish label text, matched case-insensitively against the whole short string. */
  patterns: RegExp[];
}

/**
 * Labels are shown in the language of the person's account, so every wording has to be listed
 * per language. Covered so far: English everywhere, and Hebrew for Meta (taken from a real
 * page; docs/platform-labels.md lists what is known and where it came from).
 *
 * There is no rule for "any site": a short text "AI-generated" on an unknown site is the word of
 * whoever runs it, not a platform's label. Such texts next to an item are read as a hint by
 * page-claims.ts (ADR-0014).
 */
export const PLATFORM_LABEL_RULES: PlatformLabelRule[] = [
  {
    platform: 'meta',
    hosts: ['facebook.com', 'instagram.com', 'threads.net', 'threads.com'],
    patterns: [
      // On posts, reels, stories and threads (Meta help: "How AI-generated content is identified").
      /^ai info$/i,
      /^ai content$/i,
      /^made with ai$/i,
      /^imagined with ai$/i,
      /^ai[- ]generated$/i,
      // The line that says who added the label.
      /^(?:an )?ai label was added to this (?:content|post|reel|video|story|thread) by .{1,40}$/i,
      // On accounts that mostly post AI-made content, and next to their posts.
      /^ai creator$/i,
      /^ai[- ]generated profile$/i,
      // Hebrew: "Content created using AI" and "An AI label was added to this content by ...".
      /^תוכן שנוצר באמצעות AI$/i,
      /^תווית AI נוספה לתוכן הזה על ידי .{1,40}$/i,
    ],
  },
  {
    platform: 'youtube',
    hosts: ['youtube.com'],
    // Since May 2026 the label sits on the video itself; the element can carry a little more
    // text after the label ("Learn more"), so only the start is fixed.
    patterns: [/^altered or synthetic content\b.{0,40}$/i, /^how this content was made$/i],
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
  const rules = PLATFORM_LABEL_RULES.filter((r) =>
    r.hosts.some((h) => host === h || host.endsWith(`.${h}`)),
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
