import { resolveOutcome } from '../outcome.js';
import { detectFormat, sniffImage, type ImageFormat } from '../provenance/sniff.js';
import type { DetectorResult, ReasonCode, Verdict } from '../types.js';

/**
 * Image provenance: what the file itself says about where it came from.
 *
 * 1. C2PA Content Credentials: a signed manifest. A host-provided reader (c2pa-node in Node,
 *    c2pa-web in the browser; both wrap the same Rust library) validates it and returns the
 *    manifest store as JSON; `summarizeManifestStore` turns that JSON into a small summary.
 * 2. Unsigned metadata: the IPTC "made by AI" source type and settings left by image generators.
 *
 * A declaration of AI generation gives the `verified_ai` outcome (see docs/decisions/0010).
 */

/** `trusted`: intact and signed by a certificate on the trust list. `valid`: intact, signer not recognised. */
export type C2paState = 'trusted' | 'valid' | 'invalid';

export interface C2paSummary {
  state: C2paState;
  /** Who signed the manifest (certificate issuer / common name). */
  issuer: string | null;
  signedAt: string | null;
  /** Software that produced the claim and the actions in it. */
  generators: string[];
  /** IPTC digital source type codes found in the active manifest's actions (last path segment). */
  digitalSourceTypes: string[];
  aiDeclared: boolean;
  /** Validation failure codes, e.g. `assertion.dataHash.mismatch` (the pixels were changed). */
  failures: string[];
}

/** Host-provided C2PA reader. Returns the c2pa-rs manifest store JSON, or null when there is no manifest. */
export interface C2paReader {
  read(bytes: Uint8Array, mimeType: string): Promise<unknown | null>;
}

const AI_SOURCE_TYPES = new Set([
  'trainedAlgorithmicMedia',
  'compositeWithTrainedAlgorithmicMedia',
]);
/** Status codes that do not mean the content or signature is broken. */
const NON_FATAL = new Set([
  'signingCredential.untrusted',
  'timeStamp.untrusted',
  'timeStamp.mismatch',
]);

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export function summarizeManifestStore(store: unknown): C2paSummary | null {
  if (!isObj(store)) return null;
  const manifests = isObj(store['manifests']) ? store['manifests'] : {};
  const active = manifests[str(store['active_manifest']) ?? ''];
  if (!isObj(active)) return null;

  const failures = arr(store['validation_status'])
    .map((s) => (isObj(s) ? str(s['code']) : null))
    .filter((c): c is string => c !== null && !NON_FATAL.has(c));
  const reported = str(store['validation_state']);
  const state: C2paState =
    failures.length > 0 || reported === 'Invalid'
      ? 'invalid'
      : reported === 'Trusted'
        ? 'trusted'
        : 'valid';

  const sourceTypes = new Set<string>();
  const generators = new Set<string>();
  for (const info of arr(active['claim_generator_info'])) {
    const name = isObj(info) ? str(info['name']) : null;
    if (name !== null) generators.add(name);
  }
  for (const assertion of arr(active['assertions'])) {
    if (!isObj(assertion) || !String(assertion['label']).startsWith('c2pa.actions')) continue;
    const data = isObj(assertion['data']) ? assertion['data'] : {};
    for (const action of arr(data['actions'])) {
      if (!isObj(action)) continue;
      const dst = str(action['digitalSourceType']);
      if (dst !== null) sourceTypes.add(dst.split('/').pop()!);
      const agent = action['softwareAgent'];
      const name = isObj(agent) ? str(agent['name']) : str(agent);
      if (name !== null) generators.add(name);
    }
  }
  const sig = isObj(active['signature_info']) ? active['signature_info'] : {};
  const digitalSourceTypes = [...sourceTypes];
  return {
    state,
    issuer: str(sig['issuer']) ?? str(sig['common_name']),
    signedAt: str(sig['time']),
    generators: [...generators],
    digitalSourceTypes,
    aiDeclared: digitalSourceTypes.some((t) => AI_SOURCE_TYPES.has(t)),
    failures,
  };
}

export const C2PA_DETECTOR = 'image.c2pa@0.1.0';
export const METADATA_DETECTOR = 'image.metadata@0.1.0';

export function c2paResult(summary: C2paSummary): DetectorResult {
  const details: Record<string, string | number | boolean> = { state: summary.state };
  if (summary.issuer !== null) details['issuer'] = summary.issuer;
  if (summary.generators.length > 0) details['generators'] = summary.generators.join(', ');
  if (summary.failures.length > 0) details['failures'] = summary.failures.join(', ');
  let score = 0;
  let reasons: ReasonCode[];
  if (summary.state === 'invalid') {
    // A broken manifest proves nothing either way, whatever it claims.
    reasons = ['c2pa_invalid_signature'];
  } else if (summary.aiDeclared) {
    score = 1;
    reasons =
      summary.state === 'trusted'
        ? ['c2pa_declares_ai']
        : ['c2pa_declares_ai', 'c2pa_signer_unrecognised'];
  } else {
    reasons = ['c2pa_present_no_ai_claim'];
  }
  return {
    status: 'assessed',
    signal: {
      detector: C2PA_DETECTOR,
      modality: 'image',
      kind: 'provenance',
      score,
      reasons,
      details,
    },
  };
}

/** Unsigned metadata: IPTC AI source type and generator settings (see provenance/sniff.ts). */
export function metadataResult(bytes: Uint8Array): DetectorResult {
  const sniff = sniffImage(bytes);
  const reasons: ReasonCode[] = [];
  if (sniff.xmpAiSourceTypes.length > 0) reasons.push('iptc_trained_algorithmic_media');
  if (sniff.generatorHints.length > 0) reasons.push('generator_metadata_found');
  const details: Record<string, string | number | boolean> = { format: sniff.format };
  if (sniff.generatorHints.length > 0) details['generator'] = sniff.generatorHints.join(', ');
  return {
    status: 'assessed',
    signal: {
      detector: METADATA_DETECTOR,
      modality: 'image',
      kind: 'provenance',
      score: reasons.length > 0 ? 1 : 0,
      reasons,
      details,
    },
  };
}

const MIME: Record<ImageFormat, string | null> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  unknown: null,
};

/**
 * Provenance checks for one image file. Pass the ORIGINAL file bytes: a screenshot or a
 * re-encoded copy has lost the manifest and the metadata (ADR-0008).
 */
export async function checkImageProvenance(
  bytes: Uint8Array,
  reader?: C2paReader,
): Promise<Verdict> {
  const mime = MIME[detectFormat(bytes)];
  if (mime === null)
    return resolveOutcome('image', [
      { status: 'not_assessed', detector: METADATA_DETECTOR, reason: 'unreadable_media' },
    ]);
  const results: DetectorResult[] = [metadataResult(bytes)];
  if (reader !== undefined) {
    const summary = summarizeManifestStore(await reader.read(bytes, mime));
    if (summary !== null) results.push(c2paResult(summary));
  }
  return resolveOutcome('image', results);
}
