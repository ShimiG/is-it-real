import { lookup } from 'node:dns/promises';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { tmpdir } from 'node:os';
import { extname, isAbsolute, join } from 'node:path';

/**
 * Loads image bytes for the checks: from a URL the page already shows, or from a local file
 * (e.g. a screenshot the browser tool saved). This is the only network access the server makes
 * (ADR-0003), so it is deliberately narrow:
 * - http and https only; at most 20 MB; 15 seconds; 5 redirects, each one re-checked;
 * - no private, loopback, link-local or multicast addresses, so a web page cannot make this tool
 *   probe the user's home network or local services (opt out only for tests);
 * - local files must be images (by extension) and at most 20 MB.
 * Videos follow the same rules with larger limits (100 MB and 60 seconds for a link, 200 MB for a
 * local file); a downloaded video is kept in a temporary file only while it is being checked.
 * Only the verdict leaves this server, never the bytes.
 */

export const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
export const FETCH_TIMEOUT_MS = 15_000;
export const MAX_VIDEO_URL_BYTES = 100 * 1024 * 1024;
export const MAX_VIDEO_FILE_BYTES = 200 * 1024 * 1024;
export const VIDEO_FETCH_TIMEOUT_MS = 60_000;

interface Limits {
  what: string;
  maxBytes: number;
  timeoutMs: number;
  accept: string;
}
const IMAGE_LIMITS: Limits = {
  what: 'image',
  maxBytes: MAX_MEDIA_BYTES,
  timeoutMs: FETCH_TIMEOUT_MS,
  accept: 'image/*',
};
const VIDEO_LIMITS: Limits = {
  what: 'video',
  maxBytes: MAX_VIDEO_URL_BYTES,
  timeoutMs: VIDEO_FETCH_TIMEOUT_MS,
  accept: 'video/*',
};
const mb = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;
const MAX_REDIRECTS = 5;
const VIDEO_EXTENSIONS = new Set(['.mp4', '.m4v', '.mov', '.webm', '.mkv']);
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

async function readCapped(res: Response, limits: Limits): Promise<Uint8Array> {
  const tooLarge = () =>
    new MediaError(`The ${limits.what} is larger than ${mb(limits.maxBytes)}.`, 'too_large');
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > limits.maxBytes) throw tooLarge();
  if (res.body === null) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limits.maxBytes) {
      await reader.cancel();
      throw tooLarge();
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

async function fetchGuarded(raw: string, opts: MediaOptions, limits: Limits): Promise<Uint8Array> {
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
      signal: AbortSignal.timeout(limits.timeoutMs),
      headers: { accept: limits.accept },
    });
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get('location');
      if (next === null) throw new MediaError('The link redirected nowhere.', 'unreadable');
      url = new URL(next, url);
      continue;
    }
    if (!res.ok) throw new MediaError(`The site answered ${res.status}.`, 'unreadable');
    return readCapped(res, limits);
  }
  throw new MediaError('Too many redirects.', 'unreadable');
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
  return fetchGuarded(raw, opts, IMAGE_LIMITS);
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

/** A video ready to be checked: its bytes, a file ffmpeg can read, and a way to tidy up. */
export interface LoadedVideo {
  bytes: Uint8Array;
  file: string;
  /** Removes the temporary copy, if one was made. Safe to call more than once. */
  cleanup: () => Promise<void>;
}

/**
 * Loads a video from a direct link (a plain .mp4 / .webm file address) or from a local file.
 * Streamed video (blob:, HLS or DASH playlists) has no single file to fetch and is refused with
 * a plain explanation; so is a link that turns out not to be a video file.
 */
export async function loadVideo(
  ref: { url?: string | undefined; path?: string | undefined },
  opts: MediaOptions = {},
): Promise<LoadedVideo> {
  if (ref.url !== undefined) {
    if (/^(blob|data|mediastream):/i.test(ref.url) || /\.(m3u8|mpd)(\?|#|$)/i.test(ref.url))
      throw new MediaError(
        'This video is streamed in pieces by the page, so there is no single file to fetch.',
        'blocked',
      );
    const bytes = await fetchGuarded(ref.url, opts, VIDEO_LIMITS);
    const dir = await mkdtemp(join(tmpdir(), 'isitreal-video-'));
    const file = join(dir, 'video');
    await writeFile(file, bytes);
    return { bytes, file, cleanup: () => rm(dir, { recursive: true, force: true }) };
  }
  if (ref.path === undefined)
    throw new MediaError('Give a video link or a file path.', 'unreadable');
  if (!isAbsolute(ref.path))
    throw new MediaError('Give the full path to the video file.', 'unreadable');
  if (!VIDEO_EXTENSIONS.has(extname(ref.path).toLowerCase()))
    throw new MediaError('Only video files (mp4, m4v, mov, webm, mkv) can be checked.', 'blocked');
  let size: number;
  try {
    const st = await stat(ref.path);
    if (!st.isFile()) throw new Error('not a file');
    size = st.size;
  } catch {
    throw new MediaError('That file could not be opened.', 'unreadable');
  }
  if (size > MAX_VIDEO_FILE_BYTES)
    throw new MediaError(`The video is larger than ${mb(MAX_VIDEO_FILE_BYTES)}.`, 'too_large');
  return {
    bytes: new Uint8Array(await readFile(ref.path)),
    file: ref.path,
    cleanup: async () => {},
  };
}
