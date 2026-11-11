/**
 * Builds the extension into dist/: one bundle per part (background worker, page reader, engine
 * page, side panel), plus the manifest and static files. Load dist/ in Chrome with
 * chrome://extensions > Developer mode > Load unpacked.
 */
import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'dist');
const pkg = JSON.parse(await readFile(join(here, 'package.json'), 'utf8'));

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const common = {
  bundle: true,
  target: 'chrome120',
  legalComments: 'none',
  logLevel: 'warning',
  define: { 'process.env.NODE_ENV': '"production"' },
};
// Extension pages and the service worker load ES modules; a content script cannot.
await build({
  ...common,
  format: 'esm',
  entryPoints: {
    background: join(here, 'src/background.ts'),
    offscreen: join(here, 'src/offscreen/main.ts'),
    sidepanel: join(here, 'src/sidepanel/main.ts'),
  },
  outdir: out,
});
await build({
  ...common,
  format: 'iife',
  entryPoints: { content: join(here, 'src/content/main.ts') },
  outdir: out,
});

const manifest = JSON.parse(await readFile(join(here, 'manifest.json'), 'utf8'));
manifest.version = pkg.version;
await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
await cp(join(here, 'src/sidepanel/index.html'), join(out, 'sidepanel.html'));
await cp(join(here, 'src/sidepanel/style.css'), join(out, 'sidepanel.css'));
await cp(join(here, 'src/offscreen/index.html'), join(out, 'offscreen.html'));
console.log(`apps/extension/dist built (version ${pkg.version})`);
