import type { DetectorResult, ReasonCode } from '../types.js';
import { conformalScore } from '../calibration.js';
import { applyLogistic, type LogisticModel, type LogisticResult } from '../logistic.js';
import { words } from './normalize.js';
import { isLikelyEnglish, textFeatures, type TextFeature } from './stats.js';
import model from './text-stats.model.json' with { type: 'json' };

/** Logistic model over standardised Tier 0 features, produced by `pnpm --filter @isitreal/eval train:text`. */
export interface TextStatsModel extends LogisticModel {
  id: string;
  features: TextFeature[];
  minWords: number;
  /** Raw scores of held-out HUMAN calibration texts, ascending (see calibration.ts). */
  calibration: number[];
  trainedOn: string;
}

export const TEXT_STATS_MODEL = model as TextStatsModel;

/** Which features explain a high score, in plain language. */
const FEATURE_REASON: Partial<Record<TextFeature, ReasonCode>> = {
  sentLenCV: 'text_low_burstiness',
  mattr: 'text_low_lexical_diversity',
  aiPhraseRate: 'text_ai_phrasing',
};

/** Raw (uncalibrated) logistic score and per-feature contributions. */
export function scoreTextStats(text: string, m: TextStatsModel = TEXT_STATS_MODEL): LogisticResult {
  const f = textFeatures(text);
  return applyLogistic(
    m,
    m.features.map((name) => f[name]),
  );
}

/** Tier 0 text detector: pure statistics, English only, refuses short texts. */
export function detectTextStats(
  text: string,
  m: TextStatsModel = TEXT_STATS_MODEL,
): DetectorResult {
  if (words(text).length < m.minWords)
    return { status: 'not_assessed', detector: m.id, reason: 'too_short' };
  if (!isLikelyEnglish(text))
    return { status: 'not_assessed', detector: m.id, reason: 'unsupported_language' };
  const { raw, contributions } = scoreTextStats(text, m);
  const score = conformalScore(raw, m.calibration);
  const top = Object.entries(contributions)
    .filter(([, c]) => c > 0.5)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => FEATURE_REASON[k as TextFeature] ?? 'text_uniform_style');
  const reasons = [...new Set(top)].slice(0, 3) as ReasonCode[];
  return {
    status: 'assessed',
    signal: {
      detector: m.id,
      modality: 'text',
      kind: 'statistical',
      score,
      reasons: reasons.length > 0 ? reasons : ['text_uniform_style'],
      details: { raw: Number(raw.toFixed(4)), calibrationSize: m.calibration.length },
    },
  };
}
