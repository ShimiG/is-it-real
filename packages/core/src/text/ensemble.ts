import { conformalScore } from '../calibration.js';
import { applyLogistic, type LogisticModel } from '../logistic.js';
import type { DetectorResult, ReasonCode } from '../types.js';
import { LM_FEATURES, lmFeatures, type LanguageModel, type LmFeature } from './lm.js';
import { words } from './normalize.js';
import { TEXT_FEATURES, isLikelyEnglish, textFeatures, type TextFeature } from './stats.js';
import model from './text-ensemble.model.json' with { type: 'json' };

/**
 * Tier 1 text detector: Tier 0 statistics plus language-model features (Fast-DetectGPT criterion,
 * surprisal statistics), combined by a logistic model. Feature names are prefixed `t0.` / `lm.`.
 * The weights only make sense with the language model they were trained with (`lmId`).
 */
export interface TextEnsembleModel extends LogisticModel {
  id: string;
  lmId: string;
  maxTokens: number;
  minWords: number;
  /** Raw scores of held-out HUMAN calibration texts, ascending (see calibration.ts). */
  calibration: number[];
  trainedOn: string;
}

export const TEXT_ENSEMBLE_MODEL = model as TextEnsembleModel;

const REASONS: Record<string, ReasonCode> = {
  't0.sentLenCV': 'text_low_burstiness',
  't0.mattr': 'text_low_lexical_diversity',
  't0.aiPhraseRate': 'text_ai_phrasing',
};
const reasonFor = (feature: string): ReasonCode =>
  REASONS[feature] ??
  (feature.startsWith('lm.') ? 'text_probability_curvature' : 'text_uniform_style');

export async function detectTextDeep(
  text: string,
  lm: LanguageModel,
  m: TextEnsembleModel = TEXT_ENSEMBLE_MODEL,
): Promise<DetectorResult> {
  if (lm.id !== m.lmId)
    throw new Error(`Model ${m.id} was trained with ${m.lmId}, but the language model is ${lm.id}`);
  if (words(text).length < m.minWords)
    return { status: 'not_assessed', detector: m.id, reason: 'too_short' };
  if (!isLikelyEnglish(text))
    return { status: 'not_assessed', detector: m.id, reason: 'unsupported_language' };
  const lmf = lmFeatures(await lm.run(text, m.maxTokens));
  if (lmf === null) return { status: 'not_assessed', detector: m.id, reason: 'too_short' };
  const t0 = textFeatures(text);
  const x = m.features.map((name) =>
    name.startsWith('lm.') ? lmf[name.slice(3) as LmFeature] : t0[name.slice(3) as TextFeature],
  );
  const { raw, contributions } = applyLogistic(m, x);
  const reasons = [
    ...new Set(
      Object.entries(contributions)
        .filter(([, c]) => c > 0.5)
        .sort((a, b) => b[1] - a[1])
        .map(([k]) => reasonFor(k)),
    ),
  ].slice(0, 3);
  return {
    status: 'assessed',
    signal: {
      detector: m.id,
      modality: 'text',
      kind: 'statistical',
      score: conformalScore(raw, m.calibration),
      reasons: reasons.length > 0 ? reasons : ['text_probability_curvature'],
      details: {
        raw: Number(raw.toFixed(4)),
        fdCriterion: Number(lmf.fdCriterion.toFixed(3)),
        calibrationSize: m.calibration.length,
      },
    },
  };
}

export const ENSEMBLE_FEATURE_NAMES: string[] = [
  ...TEXT_FEATURES.map((f) => `t0.${f}`),
  ...LM_FEATURES.map((f) => `lm.${f}`),
];
