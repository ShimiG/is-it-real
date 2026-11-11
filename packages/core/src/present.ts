import { OUTCOME_TEXT, REASON_TEXT, SCAM_ADVICE, SCAM_TEXT } from './reasons/en.js';
import type { PageReport, ReasonCode, ScamRisk, Verdict } from './types.js';

/**
 * Turns verdicts into what a person reads: a title, one sentence, and the reasons in plain words.
 * Shared by every host (the Claude plugin and the browser extension), so the same finding is
 * worded the same everywhere.
 */

/** One checked item. Plain words first; codes for anyone who needs them. */
export interface ItemResult {
  kind: 'text' | 'image' | 'video' | 'page';
  source: string;
  outcome: Verdict['outcome'];
  title: string;
  explanation: string;
  reasons: { code: ReasonCode; text: string }[];
  /** Facts from the checks (signer, generator, platform label...). No page content beyond short labels. */
  evidence?: Record<string, string | number | boolean>;
  note?: string;
}

export interface ScamSummary {
  risk: ScamRisk;
  headline: string;
  reasons: { code: ReasonCode; text: string; evidence?: string }[];
  advice: readonly string[];
}

/** Details that are for developers, not for the person reading the answer. */
const HIDDEN_DETAILS = new Set(['raw', 'calibrationSize', 'format', 'fdCriterion']);

export function itemFromVerdict(v: Verdict, source: string, note?: string): ItemResult {
  const evidence: Record<string, string | number | boolean> = {};
  for (const s of v.signals) {
    if (s.kind === 'scam_rule' || s.details === undefined) continue;
    for (const [k, val] of Object.entries(s.details)) {
      if (HIDDEN_DETAILS.has(k)) continue;
      evidence[k] = val;
    }
  }
  const text = OUTCOME_TEXT[v.outcome];
  return {
    kind: v.modality,
    source,
    outcome: v.outcome,
    title: text.title,
    explanation: text.body,
    reasons: v.reasons.map((code) => ({ code, text: REASON_TEXT[code] })),
    ...(Object.keys(evidence).length > 0 ? { evidence } : {}),
    ...(note === undefined ? {} : { note }),
  };
}

export function scamFromReport(report: PageReport, evidence: Map<ReasonCode, string>): ScamSummary {
  return {
    risk: report.scamRisk,
    headline: SCAM_TEXT[report.scamRisk],
    reasons: report.scamReasons.map((code) => ({
      code,
      text: REASON_TEXT[code],
      ...(evidence.has(code) ? { evidence: evidence.get(code)! } : {}),
    })),
    advice: report.scamRisk === 'high' || report.scamRisk === 'medium' ? SCAM_ADVICE : [],
  };
}
