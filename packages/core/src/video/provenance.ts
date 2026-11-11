import { c2paResult, summarizeManifestStore, type C2paReader } from '../image/provenance.js';
import { resolveOutcome } from '../outcome.js';
import { xmpAiSourceTypesIn } from '../provenance/sniff.js';
import type { DetectorResult, Verdict } from '../types.js';
import { detectVideoFormat, VIDEO_MIME } from './container.js';

export const VIDEO_C2PA_DETECTOR = 'video.c2pa@0.1.0';
export const VIDEO_METADATA_DETECTOR = 'video.metadata@0.1.0';

/** Unsigned metadata in a video file: the IPTC "made by AI" source type inside an XMP packet. */
export function videoMetadataResult(bytes: Uint8Array): DetectorResult {
  const declared = xmpAiSourceTypesIn(bytes).length > 0;
  return {
    status: 'assessed',
    signal: {
      detector: VIDEO_METADATA_DETECTOR,
      modality: 'video',
      kind: 'provenance',
      score: declared ? 1 : 0,
      reasons: declared ? ['iptc_trained_algorithmic_media'] : [],
      details: { format: detectVideoFormat(bytes) },
    },
  };
}

/**
 * Provenance checks for one video file (MP4, MOV, WebM). Pass the ORIGINAL file: a re-encoded
 * or re-uploaded copy has usually lost its Content Credentials and metadata (ADR-0008).
 * Same rules as for images: a signed AI declaration counts, a broken signature proves nothing.
 */
export async function checkVideoProvenance(
  bytes: Uint8Array,
  reader?: C2paReader,
): Promise<Verdict> {
  const format = detectVideoFormat(bytes);
  if (format === 'unknown')
    return resolveOutcome('video', [
      { status: 'not_assessed', detector: VIDEO_METADATA_DETECTOR, reason: 'unreadable_media' },
    ]);
  const results: DetectorResult[] = [videoMetadataResult(bytes)];
  const mime = VIDEO_MIME[format];
  if (reader !== undefined && mime !== null) {
    let store: unknown = null;
    try {
      store = await reader.read(bytes, mime);
    } catch {
      // The reader failed on this file (not "no manifest"): Content Credentials cannot be judged.
    }
    const summary = summarizeManifestStore(store);
    if (summary !== null) results.push(c2paResult(summary, 'video', VIDEO_C2PA_DETECTOR));
  }
  return resolveOutcome('video', results);
}
