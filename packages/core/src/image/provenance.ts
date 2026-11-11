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

/**
 * - `trusted`: intact, signed by a certificate on the trust list.
 * - `valid`: intact, signer not on the trust list.
 * - `unverified`: the content matches the manifest, but the signer's certificate or an optional
 *   record does not meet the C2PA standard, so we cannot confirm who signed it.
 * - `invalid`: the content or the signature does not match: changed after signing, or forged.
 */
export type C2paState = 'trusted' | 'valid' | 'unverified' | 'invalid';

export interface C2paSummary {
  state: C2paState;
  /** Who signed the manifest (certificate issuer / common name). */
  issuer: string | null;
  signedAt: string | null;
  /** Software that produced the claim and the actions in it (whole history). */
  generators: string[];
  /** IPTC digital source type codes found in the validated history (last path segment). */
  digitalSourceTypes: string[];
  aiDeclared: boolean;
  /**
   * Where the AI declaration was found: in the newest manifest (`active`), or in an earlier,
   * validated step of the image's history (`history`), e.g. a platform re-saved an AI image.
   */
  aiDeclaredIn: 'active' | 'history' | null;
  /** Descriptions attached to the AI actions, e.g. "Added imperceptible SynthID watermark". */
  aiDescriptions: string[];
  /** Validation failure codes, e.g. `assertion.dataHash.mismatch` (the pixels were changed). */
  failures: string[];
}

interface Failure {
  code: string;
  url: string;
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

/** Ingredient relationships whose history carries over to this image. `inputTo` (prompts, reference images) does not. */
const INHERITED_RELATIONSHIPS = new Set(['parentOf', 'componentOf']);
/** How far back to follow the history (protects against malformed or looping stores). */
const MAX_HISTORY_DEPTH = 8;

function failuresOf(v: unknown): Failure[] {
  return arr(v)
    .filter(isObj)
    .map((f) => ({ code: str(f['code']) ?? '', url: str(f['url']) ?? '' }))
    .filter((f) => f.code !== '' && !NON_FATAL.has(f.code));
}

/** Certificate problems that say nothing about whether the content was changed. */
const CREDENTIAL_CODES = new Set(['signingCredential.invalid', 'signingCredential.expired']);

/**
 * True when a failure is about conformance (who signed, or an optional record we do not use)
 * rather than integrity (the content, the claims or the signature itself do not match).
 * Anything not recognised here counts as an integrity failure.
 */
function isConformanceOnly(f: Failure): boolean {
  if (CREDENTIAL_CODES.has(f.code)) return true;
  if (f.code === 'claim.malformed' || f.code === 'assertion.malformed') {
    // Only when it points at an optional assertion: not the actions we read, not a hash binding.
    const assertion = f.url.split('c2pa.assertions/')[1] ?? '';
    return (
      assertion !== '' &&
      !assertion.startsWith('c2pa.actions') &&
      !assertion.startsWith('c2pa.hash')
    );
  }
  return false;
}

const integrityFailures = (fs: Failure[]) => fs.filter((f) => !isConformanceOnly(f));

/** True when the validator reported an integrity failure for this ingredient's manifest. */
function ingredientFailed(ingredient: Json, manifestLabel: string, store: Json): boolean {
  if (integrityFailures(failuresOf(ingredient['validation_status'])).length > 0) return true;
  const own = isObj(ingredient['validation_results']) ? ingredient['validation_results'] : {};
  const ownActive = isObj(own['activeManifest']) ? own['activeManifest'] : {};
  if (integrityFailures(failuresOf(ownActive['failure'])).length > 0) return true;
  const results = isObj(store['validation_results']) ? store['validation_results'] : {};
  for (const delta of arr(results['ingredientDeltas'])) {
    if (!isObj(delta) || !isObj(delta['validationDeltas'])) continue;
    const failed = integrityFailures(failuresOf(delta['validationDeltas']['failure'])).some((f) =>
      f.url.includes(manifestLabel),
    );
    if (failed) return true;
  }
  return false;
}

export function summarizeManifestStore(store: unknown): C2paSummary | null {
  if (!isObj(store)) return null;
  const manifests = isObj(store['manifests']) ? store['manifests'] : {};
  const activeLabel = str(store['active_manifest']) ?? '';
  const active = manifests[activeLabel];
  if (!isObj(active)) return null;

  const all = failuresOf(store['validation_status']);
  const failures = [...new Set(all.map((f) => f.code))];
  const reported = str(store['validation_state']);
  const state: C2paState =
    integrityFailures(all).length > 0 || (reported === 'Invalid' && all.length === 0)
      ? 'invalid'
      : all.length > 0
        ? 'unverified'
        : reported === 'Trusted'
          ? 'trusted'
          : 'valid';

  const sourceTypes = new Set<string>();
  const generators = new Set<string>();
  const aiDescriptions = new Set<string>();
  let aiDeclaredIn: 'active' | 'history' | null = null;
  const visited = new Set<string>();

  // Walk the newest manifest, then the validated manifests of the ingredients it was made from.
  const walk = (label: string, manifest: Json, depth: number): void => {
    if (visited.has(label) || depth > MAX_HISTORY_DEPTH) return;
    visited.add(label);
    for (const info of arr(manifest['claim_generator_info'])) {
      const name = isObj(info) ? str(info['name']) : null;
      if (name !== null) generators.add(name);
    }
    for (const assertion of arr(manifest['assertions'])) {
      if (!isObj(assertion) || !String(assertion['label']).startsWith('c2pa.actions')) continue;
      const data = isObj(assertion['data']) ? assertion['data'] : {};
      for (const action of arr(data['actions'])) {
        if (!isObj(action)) continue;
        const agent = action['softwareAgent'];
        const agentName = isObj(agent) ? str(agent['name']) : str(agent);
        if (agentName !== null) generators.add(agentName);
        const dst = str(action['digitalSourceType']);
        if (dst === null) continue;
        const code = dst.split('/').pop()!;
        sourceTypes.add(code);
        if (AI_SOURCE_TYPES.has(code)) {
          aiDeclaredIn ??= depth === 0 ? 'active' : 'history';
          const description = str(action['description']);
          if (description !== null) aiDescriptions.add(description);
        }
      }
    }
    for (const ingredient of arr(manifest['ingredients'])) {
      if (!isObj(ingredient) || !INHERITED_RELATIONSHIPS.has(String(ingredient['relationship'])))
        continue;
      const childLabel = str(ingredient['active_manifest']);
      const child = childLabel === null ? undefined : manifests[childLabel];
      if (childLabel === null || !isObj(child) || ingredientFailed(ingredient, childLabel, store))
        continue;
      walk(childLabel, child, depth + 1);
    }
  };
  walk(activeLabel, active, 0);

  const sig = isObj(active['signature_info']) ? active['signature_info'] : {};
  return {
    state,
    issuer: str(sig['issuer']) ?? str(sig['common_name']),
    signedAt: str(sig['time']),
    generators: [...generators],
    digitalSourceTypes: [...sourceTypes],
    aiDeclared: aiDeclaredIn !== null,
    aiDeclaredIn,
    aiDescriptions: [...aiDescriptions],
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
  if (summary.aiDeclaredIn !== null) details['aiDeclaredIn'] = summary.aiDeclaredIn;
  if (summary.aiDescriptions.length > 0) details['aiActions'] = summary.aiDescriptions.join('; ');
  let score = 0;
  let reasons: ReasonCode[];
  if (summary.state === 'invalid') {
    // A broken manifest proves nothing either way, whatever it claims.
    reasons = ['c2pa_invalid_signature'];
  } else if (summary.aiDeclared) {
    score = 1;
    const declared: ReasonCode =
      summary.aiDeclaredIn === 'history' ? 'c2pa_history_declares_ai' : 'c2pa_declares_ai';
    const signer: ReasonCode[] =
      summary.state === 'trusted'
        ? []
        : summary.state === 'unverified'
          ? ['c2pa_signature_not_standard']
          : ['c2pa_signer_unrecognised'];
    reasons = [declared, ...signer];
  } else {
    reasons =
      summary.state === 'unverified'
        ? ['c2pa_present_no_ai_claim', 'c2pa_signature_not_standard']
        : ['c2pa_present_no_ai_claim'];
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
    let store: unknown = null;
    try {
      store = await reader.read(bytes, mime);
    } catch {
      // The reader failed on this file (not "no manifest"): Content Credentials cannot be judged,
      // so they are left out (store stays null); the metadata checks still count.
    }
    const summary = summarizeManifestStore(store);
    if (summary !== null) results.push(c2paResult(summary));
  }
  return resolveOutcome('image', results);
}
