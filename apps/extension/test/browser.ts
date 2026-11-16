import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type BrowserContext, type Page, type Worker } from 'playwright';

/**
 * Helpers for tests that run the BUILT extension in a real Chromium: a small local web server
 * with test pages, and a browser with the extension loaded.
 */
const here = dirname(fileURLToPath(import.meta.url));
export const root = join(here, '..', '..', '..');
export const dist = join(here, '..', 'dist');

/** True when a Chromium that can load extensions is installed (it is not on every machine). */
export const browserAvailable = (): boolean => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
};

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
};

/**
 * A video site's name that the test browser resolves to this computer, so that a test page can
 * be opened at an address the extension treats as one post's own page.
 */
export const POST_SITE = 'www.instagram.com';

/** The local server's address under that name. */
export const asPostSite = (base: string): string => base.replace('127.0.0.1', POST_SITE);

/** Serves test pages from test/fixtures, and images from the other packages' fixtures under /c2pa/. */
export async function startServer(
  extra: Record<string, string> = {},
): Promise<{ server: Server; base: string }> {
  const mounts: Record<string, string> = {
    '/c2pa/': join(root, 'packages', 'c2pa-node', 'test', 'fixtures'),
    '/video/': join(root, 'packages', 'video-node', 'test', 'fixtures'),
    ...extra,
    '/': join(here, 'fixtures'),
  };
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    // /as/<any name>: the same plain picture under whatever file name a test needs.
    const renamed = path.startsWith('/as/');
    // /p/<name>/: the test page <name>.html at an address shaped like one post's own page.
    const post = /^\/p\/([\w-]+)\/$/.exec(path);
    const mount = renamed
      ? '/c2pa/'
      : post !== null
        ? '/'
        : Object.keys(mounts).find((m) => path.startsWith(m))!;
    const name = renamed
      ? 'plain.jpg'
      : post !== null
        ? `${post[1]}.html`
        : path.slice(mount.length);
    try {
      if (name.includes('..')) throw new Error('no');
      const body = await readFile(join(mounts[mount]!, name));
      res.writeHead(200, { 'content-type': TYPES[extname(name)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { server, base: `http://127.0.0.1:${(server.address() as { port: number }).port}` };
}

export interface Loaded {
  context: BrowserContext;
  worker: Worker;
  extensionId: string;
  /** Closes the browser and deletes its profile folder. */
  close(): Promise<void>;
  /** Opens a web page, then the side panel pointed at it (as a tab, which behaves the same). */
  openPanelFor(url: string): Promise<{ page: Page; panel: Page }>;
}

export async function launchWithExtension(): Promise<Loaded> {
  const profile = mkdtempSync(join(tmpdir(), 'isitreal-chrome-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    args: [
      `--disable-extensions-except=${dist}`,
      `--load-extension=${dist}`,
      // No host but this computer can be reached: the tests double as proof that the checks
      // need nothing from the internet (the model download is pointed at the local server).
      // The one name that does resolve is a stand-in that points back at this computer.
      `--host-resolver-rules=MAP ${POST_SITE} 127.0.0.1, MAP * ~NOTFOUND, EXCLUDE 127.0.0.1`,
    ],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const extensionId = new URL(worker.url()).host;
  return {
    context,
    worker,
    extensionId,
    async close() {
      await context.close();
      // The profile holds the downloaded model files (220 MB in the tests that use them).
      rmSync(profile, { recursive: true, force: true });
    },
    async openPanelFor(url) {
      const page = await context.newPage();
      await page.goto(url);
      const tabId = await worker.evaluate(
        // The newest tab with this address (earlier tests may have left one open).
        async (u) => (await chrome.tabs.query({ url: u })).at(-1)!.id!,
        url,
      );
      const panel = await context.newPage();
      await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tabId=${tabId}`);
      return { page, panel };
    },
  };
}
