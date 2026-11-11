import sharp from 'sharp';
import { decodeImageWith } from './decode.js';

export { MAX_PIXELS, decodeImageWith, type SharpLibrary } from './decode.js';
export { loadImageClassifierWith, type OrtLibrary } from './classifier.js';

/** Convenience decoder for Node: sharp imported normally. */
export const decodeImage = decodeImageWith(sharp);
