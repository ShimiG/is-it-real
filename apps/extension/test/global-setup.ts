import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Builds the extension once before any test runs. The browser tests load the built extension;
 * building it inside each test file would let two files rebuild it under each other.
 */
export default function setup(): void {
  const build = join(dirname(fileURLToPath(import.meta.url)), '..', 'build.mjs');
  const built = spawnSync(process.execPath, [build], { encoding: 'utf8' });
  if (built.status !== 0) throw new Error(`extension build failed:\n${built.stderr}`);
}
