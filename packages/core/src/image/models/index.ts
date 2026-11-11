import type { ImageClassifierModel } from '../classifier.js';
import commforLowQuality from './commfor-low-quality.model.json' with { type: 'json' };

/**
 * The image classifier the tools use, chosen by measurement (docs/eval/m3-results.md). Its
 * calibration list comes from held-out real photos scored with this exact model file
 * (eval/reference/image_calibrate.py, written in by `pnpm --filter @isitreal/eval run write:image-model`).
 */
export const IMAGE_CLASSIFIER_MODEL = commforLowQuality as unknown as ImageClassifierModel;
