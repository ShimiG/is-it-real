import type { Pixels } from '@isitreal/core';
import sharp from 'sharp';

/** Refuse absurdly large images before decoding (decompression bombs). */
export const MAX_PIXELS = 64_000_000;

/**
 * Decodes an image file (JPEG, PNG, WebP, GIF, AVIF) to RGBA pixels at its native resolution.
 * No resizing and no colour management: the frequency analysis needs the pixels as stored.
 * Returns null when the bytes are not a decodable image.
 */
export async function decodeImage(bytes: Uint8Array): Promise<Pixels | null> {
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
}
