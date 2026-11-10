import { resolveOutcome } from './outcome.js';
import { analyzeScam, type ScamInput } from './scam/engine.js';
import { detectTextStats } from './text/detector.js';
import type { PageReport } from './types.js';
import { ENGINE_VERSION } from './version.js';

/**
 * Checks a block of text (a message, an email, a page's main text): scam risk first (ADR-0007),
 * then the AI-text verdict. M1 uses Tier 0 statistics only; Tier 1 joins in M2.
 */
export function checkText(input: ScamInput): PageReport {
  const scam = analyzeScam(input);
  const verdict = resolveOutcome('text', [detectTextStats(input.text)]);
  return {
    scamRisk: scam.risk,
    scamReasons: scam.reasons,
    items: [verdict],
    engine: ENGINE_VERSION,
  };
}
