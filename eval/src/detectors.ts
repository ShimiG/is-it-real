import type { DetectorResult } from '@isitreal/core';
import type { TextItem } from './dataset.js';

export interface EvalDetector {
  id: string;
  description: string;
  run(item: TextItem): DetectorResult;
}

/** Minimum words before any text detector may judge (P2). Tuned per detector from M1 on. */
export const MIN_WORDS = 30;

/**
 * Harness sanity check, NOT a detector: a deterministic pseudo-random score per item.
 * Its AUROC should hover around 0.5; anything else means the harness is leaking labels.
 */
export const randomBaseline: EvalDetector = {
  id: 'baseline.random@0',
  description: 'Deterministic pseudo-random score (harness sanity check; expect AUROC near 0.5).',
  run(item) {
    const words = item.text.trim().split(/\s+/).filter(Boolean).length;
    if (words < MIN_WORDS)
      return { status: 'not_assessed', detector: this.id, reason: 'too_short' };
    return {
      status: 'assessed',
      signal: {
        detector: this.id,
        modality: 'text',
        kind: 'statistical',
        score: hashToUnit(item.id),
        reasons: [],
      },
    };
  },
};

export const DETECTORS: readonly EvalDetector[] = [randomBaseline];

/** FNV-1a hash mapped to [0, 1). */
function hashToUnit(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 2 ** 32;
}
