/**
 * Loads an image for the checks: the same address the page already showed, fetched again by the
 * extension so the checks see the ORIGINAL file (its labels and signature), not a screenshot
 * (ADR-0008). This is a second download: Chrome keeps an extension's cache apart from the page's.
 * Only the verdict is kept; the
 * bytes are dropped after the check.
 */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const FETCH_TIMEOUT_MS = 15_000;

export async function fetchImageBytes(url: string): Promise<Uint8Array> {
  if (!/^(https?:|data:image\/)/i.test(url)) throw new Error('unsupported address');
  const res = await fetch(url, {
    cache: 'force-cache',
    // No cookies and no "where from": the image host learns nothing it did not already know.
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > MAX_IMAGE_BYTES) throw new Error('too large');
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error('too large');
  return bytes;
}
