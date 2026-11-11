import type { Pixels } from '@isitreal/core';
import type SharpType from 'sharp';

/** Refuse absurdly large images before decoding (decompression bombs). */
export const MAX_PIXELS = 64_000_000;

export type SharpLibrary = typeof SharpType;

/**
 * Decodes an image file (JPEG, PNG, WebP, GIF, AVIF) to RGBA pixels at its native resolution.
 * No resizing, no rotation from EXIF and no colour management, like Pillow's Image.open().convert("RGB")
 * in the evaluation, so both see the same pixels. Returns null when the bytes are not a decodable image.
 */
export function decodeImageWith(
  sharp: SharpLibrary,
): (bytes: Uint8Array) => Promise<Pixels | null> {
  return async (bytes) => {
    try {
      const { data, info } = await sharp(bytes, { limitInputPixels: MAX_PIXELS, failOn: 'error' })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      return {
        width: info.width,
        height: info.height,
        data: new Uint8Array(data.buffer, data.byteOffset, data.length),
      };
    } catch {
      return null;
    }
  };
}
