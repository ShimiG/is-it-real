/**
 * Core contracts shared by every host (Claude plugin / MCP server, browser extension, mobile).
 *
 * Design rules encoded here (see docs/decisions):
 * - ADR-0001: detectors produce numbers; no LLM ever produces a Signal.
 * - ADR-0002: there is deliberately NO "human" / "real" outcome.
 */

export type Modality = 'text' | 'image' | 'video' | 'page';

/**
 * The four outcomes a user can see. There is intentionally no "human" value:
 * absence of evidence is not evidence of human authorship.
 */
export const OUTCOMES = ['verified_ai', 'likely_ai', 'no_clear_signs', 'not_assessed'] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const SCAM_RISKS = ['high', 'medium', 'low', 'none'] as const;
export type ScamRisk = (typeof SCAM_RISKS)[number];

/** How a signal was obtained. Provenance signals can produce `verified_ai` on their own. */
export const SIGNAL_KINDS = ['provenance', 'platform_label', 'statistical', 'scam_rule'] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];

/**
 * Stable, machine-readable reason codes. User-facing text for each code lives in
 * `reasons/en.ts` (one file per language, so translations need no code changes).
 */
export const REASON_CODES = [
  // provenance
  'c2pa_declares_ai',
  'c2pa_history_declares_ai',
  'c2pa_present_no_ai_claim',
  'c2pa_invalid_signature',
  'c2pa_signer_unrecognised',
  'c2pa_signature_not_standard',
  'iptc_trained_algorithmic_media',
  'generator_metadata_found',
  'platform_label_ai',
  // statistical
  'text_low_burstiness',
  'text_low_lexical_diversity',
  'text_probability_curvature',
  'text_ai_phrasing',
  'text_uniform_style',
  'image_spectral_artifacts',
  'image_classifier_ai',
  'video_temporal_inconsistency',
  // scam
  'scam_urgency',
  'scam_unusual_payment',
  'scam_secrecy',
  'scam_impersonation',
  'scam_link_mismatch',
  'scam_lookalike_domain',
  'scam_too_good_to_be_true',
  'scam_threat',
  'scam_code_request',
  'scam_personal_data_request',
  'scam_tech_support',
  'scam_family_emergency',
  'scam_upfront_fee',
  // not assessed
  'too_short',
  'unsupported_language',
  'unreadable_media',
  'uncalibrated_bucket',
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export const NOT_ASSESSED_REASONS = [
  'too_short',
  'unsupported_language',
  'unreadable_media',
  'uncalibrated_bucket',
] as const satisfies readonly ReasonCode[];
export type NotAssessedReason = (typeof NOT_ASSESSED_REASONS)[number];

/** One piece of evidence from one detector. */
export interface Signal {
  /** Detector id, e.g. `text.fast-detectgpt@0.1.0`. Versioned so eval reports are reproducible. */
  detector: string;
  modality: Modality;
  kind: SignalKind;
  /**
   * For `statistical` signals: a calibrated probability-like score in [0, 1] (higher = more AI-like).
   * For `provenance` / `platform_label`: 1 when the source declares AI generation, 0 otherwise.
   * For `scam_rule`: rule strength in [0, 1].
   */
  score: number;
  /** Reason codes that explain this signal. */
  reasons: ReasonCode[];
  /** Optional machine-readable details (e.g. matched phrase, manifest issuer). Never page content dumps. */
  details?: Record<string, string | number | boolean>;
}

/** What a detector returns: evidence, or an explicit refusal to judge. */
export type DetectorResult =
  | { status: 'assessed'; signal: Signal }
  | { status: 'not_assessed'; detector: string; reason: NotAssessedReason };

/** Thresholds produced by calibration (conformal, see ADR-0006). */
export interface Thresholds {
  /** Statistical score at/above which content is flagged `likely_ai` (target FPR alpha, default 1%). */
  likelyAi: number;
  /** Stricter threshold used for interrupting alerts in background mode (alpha ~0.1%). */
  alert: number;
}

/** The final judgement for one item (a text block, an image, a video). */
export interface Verdict {
  modality: Modality;
  outcome: Outcome;
  /** Displayed confidence in [0, 1] (isotonic/Platt calibrated); null when not assessed. */
  confidence: number | null;
  /** Whether background mode may interrupt the user for this item. */
  alert: boolean;
  signals: Signal[];
  reasons: ReasonCode[];
}

/** The judgement for a whole page: scam risk first (ADR-0007), then per-item verdicts. */
export interface PageReport {
  scamRisk: ScamRisk;
  scamReasons: ReasonCode[];
  items: Verdict[];
  /** Engine version, for reproducibility. */
  engine: string;
}
