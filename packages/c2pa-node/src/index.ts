import { Reader } from '@contentauth/c2pa-node';
import type { C2paReader } from '@isitreal/core';

/**
 * C2PA reader for Node, backed by the official Rust library (@contentauth/c2pa-node, MIT).
 * Returns the validated manifest store as JSON, or null when the file has no manifest or is a
 * type the library does not support. Runs fully offline: remote manifests are not fetched.
 */
export function createC2paReader(): C2paReader {
  return {
    async read(bytes: Uint8Array, mimeType: string): Promise<unknown | null> {
      try {
        const reader = await Reader.fromAsset({ buffer: Buffer.from(bytes), mimeType });
        return reader === null ? null : reader.json();
      } catch (err) {
        if (isNoManifest(err)) return null;
        throw err;
      }
    },
  };
}

/** The library throws for "no manifest in this file" and for unsupported file types. */
function isNoManifest(err: unknown): boolean {
  const text = String(err);
  return /JumbfNotFound|UnsupportedType|no JUMBF data found|ProvenanceMissing/i.test(text);
}
