import { exifOrientation, undoOrientation, type Pixels } from '@isitreal/core';

/** Refuse absurdly large images before reading their pixels (the same limit as the plugin). */
export const MAX_PIXELS = 64_000_000;

/**
 * Decodes an image file to RGBA pixels at its native resolution, the way the plugin and the
 * evaluation do: no resizing, no colour management, and not turned by the photo's orientation
 * note. A browser always applies that note, so it is undone here. Returns null when the bytes are
 * not a decodable image.
 */
export async function decodeImage(bytes: Uint8Array): Promise<Pixels | null> {
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>]), {
      colorSpaceConversion: 'none',
      premultiplyAlpha: 'none',
    });
    const { width, height } = bitmap;
    if (width === 0 || height === 0 || width * height > MAX_PIXELS) return null;
    const context = new OffscreenCanvas(width, height).getContext('2d', {
      willReadFrequently: true,
      colorSpace: 'srgb',
    });
    if (context === null) return null;
    context.drawImage(bitmap, 0, 0);
    const shown = { width, height, data: context.getImageData(0, 0, width, height).data };
    return undoOrientation(shown, exifOrientation(bytes));
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
}

/** A small copy of the picture for the result card, as a data: address. Null when it cannot be made. */
export async function thumbnail(bytes: Uint8Array, side = 160): Promise<string | null> {
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>]));
    const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
    const data = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < data.length; i += 0x8000)
      binary += String.fromCharCode(...data.subarray(i, i + 0x8000));
    return `data:image/jpeg;base64,${btoa(binary)}`;
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
}
