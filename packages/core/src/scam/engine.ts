import type { ReasonCode, ScamRisk, Signal } from '../types.js';
import { normalizeText, splitSentences } from '../text/normalize.js';
import {
  checkLinkMismatch,
  checkLookalike,
  extractHosts,
  registrableDomain,
  BRANDS,
} from './domains.js';
import { FAMILY_EMERGENCY, NEGATION, REPORTING_SPEECH, SCAM_RULES } from './rules.js';

export const SCAM_ENGINE_VERSION = 'scam-rules@0.1.0';

export interface ScamInput {
  /** Visible text of the message or page. */
  text: string;
  /** Hostname of the page being viewed, if any (enables impersonation-vs-domain checks). */
  pageHost?: string;
  /** Links on the page: visible text and real destination. */
  links?: { text: string; href: string }[];
}

export interface ScamHit {
  rule: string;
  reason: ReasonCode;
  weight: number;
  /** Short matched phrase, for the evidence panel. */
  evidence: string;
}

export interface ScamResult {
  risk: ScamRisk;
  score: number;
  hits: ScamHit[];
  signals: Signal[];
  reasons: ReasonCode[];
}

/** Risk bands on the summed rule weights. Tuned on the dev set only (eval/datasets/scam/dev.jsonl). */
export const SCAM_THRESHOLDS = { high: 4, medium: 2.5 } as const;

export function analyzeScam(input: ScamInput): ScamResult {
  // Common texting shorthand, so "u have won" reads like "you have won".
  const text = normalizeText(input.text)
    .replace(/\bu\b/gi, 'you')
    .replace(/\bur\b/gi, 'your')
    .replace(/\b2day\b/gi, 'today');
  const sentences = splitSentences(text).map((s) => s.toLowerCase());
  const best = new Map<string, ScamHit>();
  const add = (hit: ScamHit) => {
    const prev = best.get(hit.rule);
    if (prev === undefined || hit.weight > prev.weight) best.set(hit.rule, hit);
  };

  // Sentence rules: a rule counts once per text, plus `stack` for each further distinct pattern.
  for (const rule of SCAM_RULES) {
    const matched = new Map<number, string>();
    for (const sentence of sentences) {
      if (REPORTING_SPEECH.test(sentence)) continue;
      rule.patterns.forEach((re, i) => {
        if (matched.has(i)) return;
        const m = re.exec(sentence);
        if (m === null) return;
        if (rule.negatable && NEGATION.test(sentence.slice(0, m.index))) return;
        matched.set(i, m[0]);
      });
    }
    if (matched.size === 0) continue;
    const weight = Math.min(
      rule.maxWeight ?? rule.weight,
      rule.weight + (rule.stack ?? 0) * (matched.size - 1),
    );
    add({ rule: rule.id, reason: rule.reason, weight, evidence: clip([...matched.values()][0]!) });
  }

  // Family emergency: parts are usually spread over several sentences.
  const lower = sentences.filter((s) => !REPORTING_SPEECH.test(s)).join(' ');
  const who = FAMILY_EMERGENCY.who.exec(lower);
  if (who !== null && FAMILY_EMERGENCY.trouble.test(lower) && FAMILY_EMERGENCY.money.test(lower)) {
    add({
      rule: 'family_emergency',
      reason: FAMILY_EMERGENCY.reason,
      weight: FAMILY_EMERGENCY.weight,
      evidence: clip(who[0]),
    });
  }

  // Domains mentioned in the text, or links on the page.
  const hosts = [...extractHosts(text), ...(input.links ?? []).flatMap((l) => safeHost(l.href))];
  for (const host of hosts) {
    const look = checkLookalike(host);
    if (look !== null) {
      add({
        rule: 'lookalike_domain',
        reason: 'scam_lookalike_domain',
        weight: 3,
        evidence: `${host} (not ${look.brand})`,
      });
      break;
    }
  }
  for (const link of input.links ?? []) {
    const mismatch = checkLinkMismatch(link.text, link.href);
    if (mismatch !== null) {
      add({ rule: 'link_mismatch', reason: 'scam_link_mismatch', weight: 2.5, evidence: mismatch });
      break;
    }
  }

  // The page itself claims to be a brand it isn't hosted by.
  if (input.pageHost !== undefined && best.has('impersonation')) {
    const page = registrableDomain(input.pageHost);
    const claimed = BRANDS.find((b) => new RegExp(`\\b${b.name.toLowerCase()}\\b`).test(lower));
    if (claimed !== undefined && !claimed.domains.includes(page)) {
      add({
        rule: 'impersonation',
        reason: 'scam_impersonation',
        weight: 3,
        evidence: `${claimed.name} on ${page}`,
      });
    }
  }

  const hits = [...best.values()].sort((a, b) => b.weight - a.weight);
  const score = hits.reduce((s, h) => s + h.weight, 0);
  const risk: ScamRisk =
    score >= SCAM_THRESHOLDS.high
      ? 'high'
      : score >= SCAM_THRESHOLDS.medium
        ? 'medium'
        : score > 0
          ? 'low'
          : 'none';
  const signals: Signal[] = hits.map((h) => ({
    detector: `${SCAM_ENGINE_VERSION}#${h.rule}`,
    modality: 'page',
    kind: 'scam_rule',
    score: Math.min(1, h.weight / 3),
    reasons: [h.reason],
    details: { evidence: h.evidence },
  }));
  return { risk, score, hits, signals, reasons: hits.map((h) => h.reason) };
}

function clip(s: string): string {
  return s.length > 60 ? `${s.slice(0, 57)}...` : s;
}

function safeHost(href: string): string[] {
  try {
    return [new URL(href).hostname];
  } catch {
    return [];
  }
}
