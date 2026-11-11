import type { Pixels } from './spectral.js';

/**
 * EXIF orientation: a note in a photo file saying "show me turned" (phones store the sensor's
 * pixels and add this note instead of turning them).
 *
 * The evaluation and the plugin read the pixels as stored, without turning them. A web browser
 * always applies the note when it decodes a picture. To give the picture model the same input
 * everywhere, a browser host reads the note with `exifOrientation` and turns the picture back
 * with `undoOrientation`.
 */

/** The orientation note of a JPEG file: 1 (as stored) to 8. 1 when there is none. */
export function exifOrientation(bytes: Uint8Array): number {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;
  let p = 2;
  while (p + 4 <= bytes.length) {
    if (bytes[p] !== 0xff) return 1;
    const marker = bytes[p + 1]!;
    // Start of the picture data, or the end: no metadata follows.
    if (marker === 0xda || marker === 0xd9) return 1;
    const size = (bytes[p + 2]! << 8) | bytes[p + 3]!;
    if (size < 2) return 1;
    if (marker === 0xe1 && isExif(bytes, p + 4))
      return orientationInTiff(bytes, p + 10, p + 2 + size);
    p += 2 + size;
  }
  return 1;
}

const isExif = (b: Uint8Array, at: number): boolean =>
  b[at] === 0x45 &&
  b[at + 1] === 0x78 &&
  b[at + 2] === 0x69 &&
  b[at + 3] === 0x66 &&
  b[at + 4] === 0 &&
  b[at + 5] === 0;

function orientationInTiff(b: Uint8Array, start: number, end: number): number {
  const limit = Math.min(end, b.length);
  if (start + 8 > limit) return 1;
  const little = b[start] === 0x49 && b[start + 1] === 0x49;
  if (!little && !(b[start] === 0x4d && b[start + 1] === 0x4d)) return 1;
  const u16 = (at: number) => (little ? b[at]! | (b[at + 1]! << 8) : (b[at]! << 8) | b[at + 1]!);
  const u32 = (at: number) =>
    little
      ? (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0
      : ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;
  const ifd = start + u32(start + 4);
  if (ifd + 2 > limit) return 1;
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > limit) return 1;
    if (u16(entry) !== 0x0112) continue;
    const value = u16(entry + 8);
    return value >= 1 && value <= 8 ? value : 1;
  }
  return 1;
}

/**
 * Turns a picture that was decoded WITH its orientation note applied back into the stored
 * pixels. `shown` is what the browser decoded; `orientation` is the note (1 to 8).
 */
export function undoOrientation(shown: Pixels, orientation: number): Pixels {
  if (orientation <= 1 || orientation > 8) return shown;
  const swapped = orientation >= 5;
  const W = swapped ? shown.height : shown.width;
  const H = swapped ? shown.width : shown.height;
  const out = new Uint8Array(W * H * 4);
  const src = shown.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // Where the stored pixel (x, y) is in the shown picture.
      let sx: number;
      let sy: number;
      switch (orientation) {
        case 2:
          sx = W - 1 - x;
          sy = y;
          break;
        case 3:
          sx = W - 1 - x;
          sy = H - 1 - y;
          break;
        case 4:
          sx = x;
          sy = H - 1 - y;
          break;
        case 5:
          sx = y;
          sy = x;
          break;
        case 6:
          sx = H - 1 - y;
          sy = x;
          break;
        case 7:
          sx = H - 1 - y;
          sy = W - 1 - x;
          break;
        default:
          sx = y;
          sy = W - 1 - x;
      }
      const from = (sy * shown.width + sx) * 4;
      const to = (y * W + x) * 4;
      out[to] = src[from]!;
      out[to + 1] = src[from + 1]!;
      out[to + 2] = src[from + 2]!;
      out[to + 3] = src[from + 3]!;
    }
  }
  return { width: W, height: H, data: out };
}
