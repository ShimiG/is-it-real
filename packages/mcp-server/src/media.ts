import { lookup } from 'node:dns/promises';
import { readFile, stat } from 'node:fs/promises';
import { isIP } from 'node:net';
import { extname, isAbsolute } from 'node:path';

/**
 * Loads image bytes for the checks: from a URL the page already shows, or from a local file
 * (e.g. a screenshot the browser tool saved). This is the only network access the server makes
 * (ADR-0003), so it is deliberately narrow:
 * - http and https only; at most 20 MB; 15 seconds; 5 redirects, each one re-checked;
 * - no private, loopback, link-local or multicast addresses, so a web page cannot make this tool
 *   probe the user's home network or local services (opt out only for tests);
 * - local files must be images (by extension) and at most 20 MB.
 * Only the verdict leaves this server, never the bytes.
 */

export const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
export const FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;
const IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.avif',
  '.heic',
  '.heif',
]);

export class MediaError extends Error {
  constructor(
    message: string,
    readonly kind: 'blocked' | 'too_large' | 'unreadable',
  ) {
    super(message);
  }
}

export interface MediaOptions {
  /** Tests only: allow private and loopback addresses. */
  allowPrivateNetwork?: boolean;
  fetchImpl?: typeof fetch;
}

/** True for addresses a web page must not be able to reach through this tool. */
export function isPrivateAddress(address: string): boolean {
  const v = isIP(address);
  if (v === 4) {
    const [a, b] = address.split('.').map(Number) as [number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      (a === 169 && b === 254) || // link-local
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) || // benchmarking
      a >= 224 // multicast and reserved
    );
  }
  if (v === 6) {
    const x = address.toLowerCase();
    const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]!);
    return (
      x === '::' ||
      x === '::1' ||
      x.startsWith('fc') ||
      x.startsWith('fd') || // unique local
      x.startsWith('fe8') ||
      x.startsWith('fe9') ||
      x.startsWith('fea') ||
      x.startsWith('feb') || // link-local
      x.startsWith('ff') // multicast
    );
  }
  return true; // not an address at all: refuse
}

async function assertPublicHost(url: URL, opts: MediaOptions): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new MediaError(
      `Only http and https links can be checked (got ${url.protocol}).`,
      'blocked',
    );
  if (opts.allowPrivateNetwork === true) return;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (addresses.length === 0 || addresses.some(isPrivateAddress))
    throw new MediaError(
      'That address is on a private or local network, so it is not fetched.',
      'blocked',
    );
}

async function readCapped(res: Response): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > MAX_MEDIA_BYTES)
    throw new MediaError('The image is larger than 20 MB.', 'too_large');
  if (res.body === null) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_MEDIA_BYTES) {
      await reader.cancel();
      throw new MediaError('The image is larger than 20 MB.', 'too_large');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

export async function loadFromUrl(raw: string, opts: MediaOptions = {}): Promise<Uint8Array> {
  if (raw.startsWith('data:image/')) {
    const comma = raw.indexOf(',');
    const meta = raw.slice(0, comma);
    const body = raw.slice(comma + 1);
    if (comma < 0 || !meta.endsWith(';base64'))
      throw new MediaError('Unsupported data link.', 'unreadable');
    if (body.length > (MAX_MEDIA_BYTES * 4) / 3)
      throw new MediaError('The image is larger than 20 MB.', 'too_large');
    return new Uint8Array(Buffer.from(body, 'base64'));
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new MediaError('That is not a valid link.', 'unreadable');
  }
  const doFetch = opts.fetchImpl ?? fetch;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHost(url, opts);
    const res = await doFetch(url, {
      redirect: 'manual',
      credentials: 'omit',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: 'image/*' },
    });
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get('location');
      if (next === null) throw new MediaError('The link redirected nowhere.', 'unreadable');
      url = new URL(next, url);
      continue;
    }
    if (!res.ok) throw new MediaError(`The site answered ${res.status}.`, 'unreadable');
    return readCapped(res);
  }
  throw new MediaError('Too many redirects.', 'unreadable');
}

export async function loadFromPath(path: string): Promise<Uint8Array> {
  if (!isAbsolute(path))
    throw new MediaError('Give the full path to the image file.', 'unreadable');
  if (!IMAGE_EXTENSIONS.has(extname(path).toLowerCase()))
    throw new MediaError(
      'Only image files (jpg, png, webp, gif, avif, heic) can be checked.',
      'blocked',
    );
  let size: number;
  try {
    const s = await stat(path);
    if (!s.isFile()) throw new Error('not a file');
    size = s.size;
  } catch {
    throw new MediaError('That file could not be opened.', 'unreadable');
  }
  if (size > MAX_MEDIA_BYTES) throw new MediaError('The image is larger than 20 MB.', 'too_large');
  return new Uint8Array(await readFile(path));
}
