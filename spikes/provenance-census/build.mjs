import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

const out = 'dist';
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await build({
  entryPoints: ['src/content.ts', 'src/background.ts', 'src/popup.ts'],
  bundle: true,
  format: 'esm',
  target: 'chrome120',
  outdir: out,
  logLevel: 'info',
});
await cp('public', out, { recursive: true });
console.log(`Load ${out}/ as an unpacked extension (chrome://extensions, Developer mode).`);
