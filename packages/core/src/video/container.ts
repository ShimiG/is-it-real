/**
 * Which kind of video file is this? Decided from the first bytes, never from the file name,
 * so the frame extractor can be told the exact format and cannot be tricked into reading a
 * playlist or a script as "video".
 */
export type VideoFormat = 'mp4' | 'mov' | 'webm' | 'unknown';

/** ISO-BMFF brands that are still images, not video. */
const IMAGE_BRANDS = new Set(['avif', 'avis', 'heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1']);

export function detectVideoFormat(b: Uint8Array): VideoFormat {
  if (b.length >= 12 && String.fromCharCode(b[4]!, b[5]!, b[6]!, b[7]!) === 'ftyp') {
    const brand = String.fromCharCode(b[8]!, b[9]!, b[10]!, b[11]!);
    if (IMAGE_BRANDS.has(brand)) return 'unknown';
    return brand === 'qt  ' ? 'mov' : 'mp4';
  }
  // Matroska / WebM start with the EBML magic number.
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3)
    return 'webm';
  return 'unknown';
}

/** Media type for the Content Credentials reader; null when it cannot read that container. */
export const VIDEO_MIME: Record<VideoFormat, string | null> = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: null,
  unknown: null,
};
