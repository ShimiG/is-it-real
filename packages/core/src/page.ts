import { resolveOutcome } from './outcome.js';
import { analyzeScam, type ScamInput } from './scam/engine.js';
import { detectTextStats } from './text/detector.js';
import { detectTextDeep } from './text/ensemble.js';
import type { LanguageModel } from './text/lm.js';
import type { PageReport } from './types.js';
import { ENGINE_VERSION } from './version.js';

/**
 * Checks a block of text (a message, an email, a page's main text): scam risk first (ADR-0007),
 * then the AI-text verdict. This version needs no model: Tier 0 statistics only.
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

/**
 * Same as `checkText`, with the Tier 1 detector: needs a local language model (the "deep check").
 * The ensemble already includes the Tier 0 statistics, so it replaces them instead of adding to them.
 */
export async function checkTextDeep(input: ScamInput, lm: LanguageModel): Promise<PageReport> {
  const scam = analyzeScam(input);
  const verdict = resolveOutcome('text', [await detectTextDeep(input.text, lm)]);
  return {
    scamRisk: scam.risk,
    scamReasons: scam.reasons,
    items: [verdict],
    engine: ENGINE_VERSION,
  };
}
