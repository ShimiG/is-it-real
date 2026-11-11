import { describe, expect, it } from 'vitest';
import {
  MAX_MEDIA_BYTES,
  MediaError,
  isPrivateAddress,
  loadFromPath,
  loadFromUrl,
} from '../src/media.js';

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    'fd00::1',
    'fe80::1',
    '::ffff:192.168.0.1',
    'not-an-ip',
  ])('blocks %s', (a) => expect(isPrivateAddress(a)).toBe(true));
  it.each(['8.8.8.8', '172.32.0.1', '100.128.0.1', '2606:4700::1111'])('allows %s', (a) =>
    expect(isPrivateAddress(a)).toBe(false),
  );
});

const ok = (body: Uint8Array, headers: Record<string, string> = {}) =>
  new Response(new Blob([new Uint8Array(body)]), { status: 200, headers });
const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to } });

describe('loadFromUrl', () => {
  it('refuses non-web links', async () => {
    await expect(loadFromUrl('file:///etc/passwd')).rejects.toMatchObject({ kind: 'blocked' });
    await expect(loadFromUrl('ftp://example.com/a.jpg')).rejects.toBeInstanceOf(MediaError);
  });

  it('refuses private and loopback addresses, including the cloud metadata address', async () => {
    for (const u of [
      'http://127.0.0.1/a.jpg',
      'http://192.168.1.1/a.jpg',
      'http://169.254.169.254/latest',
      'http://[::1]/a.png',
    ])
      await expect(loadFromUrl(u), u).rejects.toMatchObject({ kind: 'blocked' });
  });

  it('re-checks every redirect hop', async () => {
    const fetchImpl = (async () => redirect('http://10.0.0.5/secret.jpg')) as typeof fetch;
    await expect(loadFromUrl('http://8.8.8.8/a.jpg', { fetchImpl })).rejects.toMatchObject({
      kind: 'blocked',
    });
  });

  it('follows a public redirect and returns the bytes', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (u: URL | string) => {
      calls.push(String(u));
      return calls.length === 1 ? redirect('/b.jpg') : ok(new Uint8Array([1, 2, 3]));
    }) as typeof fetch;
    expect(await loadFromUrl('http://8.8.8.8/a.jpg', { fetchImpl })).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(calls).toEqual(['http://8.8.8.8/a.jpg', 'http://8.8.8.8/b.jpg']);
  });

  it('stops at 20 MB, by header or by counting', async () => {
    const big = (async () =>
      ok(new Uint8Array(1), { 'content-length': String(MAX_MEDIA_BYTES + 1) })) as typeof fetch;
    await expect(loadFromUrl('http://8.8.8.8/a.jpg', { fetchImpl: big })).rejects.toMatchObject({
      kind: 'too_large',
    });
    const stream = (async () =>
      new Response(
        new ReadableStream({
          pull(c) {
            c.enqueue(new Uint8Array(4 * 1024 * 1024));
          },
        }),
      )) as typeof fetch;
    await expect(loadFromUrl('http://8.8.8.8/a.jpg', { fetchImpl: stream })).rejects.toMatchObject({
      kind: 'too_large',
    });
  });

  it('accepts inline data images', async () => {
    const b64 = Buffer.from([0xff, 0xd8, 0xff]).toString('base64');
    expect(await loadFromUrl(`data:image/jpeg;base64,${b64}`)).toEqual(
      new Uint8Array([0xff, 0xd8, 0xff]),
    );
  });
});

describe('loadFromPath', () => {
  it('only opens image files given by full path', async () => {
    await expect(loadFromPath('relative/a.jpg')).rejects.toMatchObject({ kind: 'unreadable' });
    await expect(loadFromPath('/etc/passwd')).rejects.toMatchObject({ kind: 'blocked' });
    await expect(loadFromPath('/no/such/file.png')).rejects.toMatchObject({ kind: 'unreadable' });
  });
});
