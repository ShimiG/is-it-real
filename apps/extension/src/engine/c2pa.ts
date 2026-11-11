import { settingsToJson } from '@contentauth/c2pa-utilities';
import init, { WasmReader } from '@contentauth/c2pa-wasm';
import type { C2paReader } from '@isitreal/core';

/**
 * Content Credentials reader for the browser: the official C2PA library (c2pa-rs) compiled to
 * WebAssembly. The same library family as the plugin's reader (packages/c2pa-node), with the same
 * settings: signers are checked against the bundled official trust list, and nothing is fetched
 * (no remote manifests, no certificate revocation look-ups; ADR-0003).
 *
 * The low-level module is used directly, on the engine page itself. The library's own wrapper
 * starts a worker from generated code, which Chrome does not allow in extensions.
 */
export interface WasmC2paSettings {
  /** Trust anchors in PEM format (the official C2PA trust list). Omit for no trust list. */
  trustAnchorsPem?: string;
  /** Extra trusted root certificates in PEM format (tests). */
  extraAnchorsPem?: string;
}

/** The library throws for "no manifest in this file" and for unsupported file types. */
const NO_MANIFEST = /JumbfNotFound|UnsupportedType|no JUMBF data found|ProvenanceMissing/i;

let loaded: Promise<unknown> | null = null;

/**
 * @param wasm The library's WebAssembly file: an address the page may fetch, or its bytes.
 */
export async function createWasmC2paReader(
  wasm: string | URL | BufferSource,
  settings: WasmC2paSettings = {},
): Promise<C2paReader> {
  loaded ??= init({ module_or_path: wasm });
  await loaded;
  const context = settingsToJson({
    verify: { verifyTrust: true, ocspFetch: false, remoteManifestFetch: false },
    trust: {
      verifyTrustList: true,
      ...(settings.trustAnchorsPem === undefined ? {} : { trustAnchors: settings.trustAnchorsPem }),
      ...(settings.extraAnchorsPem === undefined ? {} : { userAnchors: settings.extraAnchorsPem }),
    },
  });
  return {
    async read(bytes: Uint8Array, mimeType: string): Promise<unknown | null> {
      let reader: WasmReader;
      try {
        reader = await WasmReader.fromBytes(mimeType, bytes, context);
      } catch (err) {
        if (NO_MANIFEST.test(String(err))) return null;
        throw err;
      }
      try {
        return JSON.parse(reader.json()) as unknown;
      } finally {
        reader.free();
      }
    },
  };
}
