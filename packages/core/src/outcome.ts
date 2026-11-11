import type { DetectorResult, Modality, ReasonCode, Signal, Thresholds, Verdict } from './types.js';

export const DEFAULT_THRESHOLDS: Thresholds = { likelyAi: 0.99, alert: 0.999 };

const isDeclaredAi = (s: Signal): boolean =>
  (s.kind === 'provenance' || s.kind === 'platform_label') && s.score >= 1;

/**
 * Turn detector results for ONE item into a Verdict.
 *
 * Rules (ADR-0002, ADR-0006):
 * 1. Any provenance or platform label that declares AI generation -> `verified_ai` (hard override).
 * 2. Otherwise, with no statistical signal: `no_clear_signs` when provenance was checked and
 *    declared nothing, `not_assessed` when no detector could assess the item.
 * 3. Otherwise the strongest statistical score is compared with the conformal threshold:
 *    at/above -> `likely_ai`; below -> `no_clear_signs`. Either way, what provenance found
 *    without declaring AI (a broken signature, a record with no AI claim) is kept as a reason.
 * Nothing ever yields "human".
 *
 * M0 note: step 3 uses max(score) as a placeholder; the calibrated combiner arrives in M2/M3.
 */
export function resolveOutcome(
  modality: Modality,
  results: readonly DetectorResult[],
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): Verdict {
  const signals = results.flatMap((r) => (r.status === 'assessed' ? [r.signal] : []));
  const declared = signals.filter(isDeclaredAi);

  if (declared.length > 0) {
    return {
      modality,
      outcome: 'verified_ai',
      confidence: 1,
      alert: true,
      signals,
      reasons: unique(declared.flatMap((s) => s.reasons)),
    };
  }

  const statistical = signals.filter((s) => s.kind === 'statistical');
  if (statistical.length === 0) {
    // Provenance was checked and nothing declared AI: an honest "no clear signs", with whatever
    // the check did find (e.g. a manifest with no AI claim, or a broken signature) as context.
    const checked = signals.filter((s) => s.kind === 'provenance' || s.kind === 'platform_label');
    const notAssessed = results.flatMap((r) => (r.status === 'not_assessed' ? [r.reason] : []));
    if (checked.length > 0) {
      return {
        modality,
        outcome: 'no_clear_signs',
        confidence: null,
        alert: false,
        signals,
        // Also say why a further check was skipped (e.g. the picture model does not judge drawings).
        reasons: unique([...checked.flatMap((s) => s.reasons), ...notAssessed]),
      };
    }
    return {
      modality,
      outcome: 'not_assessed',
      confidence: null,
      alert: false,
      signals,
      reasons: unique(notAssessed.length > 0 ? notAssessed : ['unreadable_media']),
    };
  }

  const top = statistical.reduce((a, b) => (b.score > a.score ? b : a));
  const flagged = top.score >= thresholds.likelyAi;
  // What the label and signature checks found without declaring AI (e.g. a broken signature)
  // stays in the answer whatever the statistical check says.
  const context = signals
    .filter((s) => s.kind === 'provenance' || s.kind === 'platform_label')
    .flatMap((s) => s.reasons);
  return {
    modality,
    outcome: flagged ? 'likely_ai' : 'no_clear_signs',
    confidence: top.score,
    alert: top.score >= thresholds.alert,
    signals,
    reasons: unique([...(flagged ? top.reasons : []), ...context]),
  };
}

function unique<T>(xs: readonly T[]): T[] {
  return [...new Set(xs)];
}

export type { ReasonCode };
