import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as lib from '@contentauth/c2pa-node';
import type { C2paReader } from '@isitreal/core';
import { createC2paReaderWith, type C2paLibrary } from './reader.js';

export { createC2paReaderWith, type C2paLibrary, type C2paReaderSettings } from './reader.js';

/** Directory holding the bundled trust lists (see trust/README.md). */
export const TRUST_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'trust');
export const TRUST_LIST_FILE = 'C2PA-TRUST-LIST.pem';

export interface C2paReaderOptions {
  /**
   * `official` (default): signers are checked against the bundled C2PA trust list.
   * `none`: no trust list, so every intact signature reports as "signer not recognised".
   */
  trust?: 'official' | 'none';
  /** Extra trusted root certificates in PEM format (for example a company's own signer, or test certificates). */
  extraAnchorsPem?: string;
}

/** Convenience reader for Node: the library imported normally and the bundled trust list. */
export function createC2paReader(options: C2paReaderOptions = {}): C2paReader {
  const useList = (options.trust ?? 'official') === 'official';
  return createC2paReaderWith(lib as unknown as C2paLibrary, {
    ...(useList ? { trustAnchorsPem: readFileSync(join(TRUST_DIR, TRUST_LIST_FILE), 'utf8') } : {}),
    ...(options.extraAnchorsPem === undefined ? {} : { extraAnchorsPem: options.extraAnchorsPem }),
  });
}
