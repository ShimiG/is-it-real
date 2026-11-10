import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Context, Reader } from '@contentauth/c2pa-node';
import type { C2paReader } from '@isitreal/core';

const trustDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'trust');

export interface C2paReaderOptions {
  /**
   * `official` (default): signers are checked against the bundled C2PA trust list.
   * `none`: no trust list, so every intact signature reports as "signer not recognised".
   */
  trust?: 'official' | 'none';
  /** Extra trusted root certificates in PEM format (for example a company's own signer, or test certificates). */
  extraAnchorsPem?: string;
}

/**
 * C2PA reader for Node, backed by the official Rust library (@contentauth/c2pa-node, MIT).
 * Returns the validated manifest store as JSON, or null when the file has no manifest or is a
 * type the library does not support. Runs fully offline: remote manifests and certificate
 * revocation (OCSP) responses are not fetched (ADR-0003).
 */
export function createC2paReader(options: C2paReaderOptions = {}): C2paReader {
  const useList = (options.trust ?? 'official') === 'official';
  const context = new Context({
    verify: { verifyTrust: true, ocspFetch: false, remoteManifestFetch: false },
    trust: {
      verifyTrustList: true,
      ...(useList
        ? { trustAnchors: readFileSync(join(trustDir, 'C2PA-TRUST-LIST.pem'), 'utf8') }
        : {}),
      ...(options.extraAnchorsPem === undefined ? {} : { userAnchors: options.extraAnchorsPem }),
    },
  });
  return {
    async read(bytes: Uint8Array, mimeType: string): Promise<unknown | null> {
      try {
        const reader = await Reader.fromAsset({ buffer: Buffer.from(bytes), mimeType }, context);
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
  return /JumbfNotFound|UnsupportedType|no JUMBF data found|ProvenanceMissing/i.test(String(err));
}
