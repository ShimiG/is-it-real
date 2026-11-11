import type { C2paReader } from '@isitreal/core';

/** The parts of @contentauth/c2pa-node this reader uses. Passed in so a host can load the library its own way. */
export interface C2paLibrary {
  Context: new (settings: Record<string, unknown>) => unknown;
  Reader: {
    fromAsset(
      asset: { buffer: Buffer; mimeType: string },
      context?: unknown,
    ): Promise<{ json(): unknown } | null>;
  };
}

export interface C2paReaderSettings {
  /** Trust anchors in PEM format (the official C2PA trust list). Omit for no trust list. */
  trustAnchorsPem?: string;
  /** Extra trusted root certificates in PEM format (for example a company's own signer, or test certificates). */
  extraAnchorsPem?: string;
}

/**
 * C2PA reader backed by the official Rust library. Returns the validated manifest store as JSON,
 * or null when the file has no manifest or is a type the library does not support. Runs fully
 * offline: remote manifests and certificate revocation (OCSP) responses are not fetched (ADR-0003).
 */
export function createC2paReaderWith(
  lib: C2paLibrary,
  settings: C2paReaderSettings = {},
): C2paReader {
  const context = new lib.Context({
    verify: { verifyTrust: true, ocspFetch: false, remoteManifestFetch: false },
    trust: {
      verifyTrustList: true,
      ...(settings.trustAnchorsPem === undefined ? {} : { trustAnchors: settings.trustAnchorsPem }),
      ...(settings.extraAnchorsPem === undefined ? {} : { userAnchors: settings.extraAnchorsPem }),
    },
  });
  return {
    async read(bytes: Uint8Array, mimeType: string): Promise<unknown | null> {
      try {
        const reader = await lib.Reader.fromAsset(
          { buffer: Buffer.from(bytes), mimeType },
          context,
        );
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
