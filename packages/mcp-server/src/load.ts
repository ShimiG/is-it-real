import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { C2paReader, LanguageModel } from '@isitreal/core';
import { createC2paReaderWith, type C2paLibrary } from '@isitreal/c2pa-node/reader';
import { GPT2_ZOO, loadGpt2With, type OrtLibrary } from '@isitreal/lm-node/gpt2';

/**
 * Loads the optional native parts at run time, from the plugin's data folder, so the plugin
 * itself can ship as a single JavaScript file.
 *
 * - Content Credentials: @contentauth/c2pa-node. Installed with npm into the data folder on first
 *   use (needs network once). Until then, and if that fails, images get the metadata checks only.
 * - Deep text check: only when ISITREAL_GPT2_MODEL points at the model file; needs onnxruntime-node
 *   in the data folder (installed on first use the same way).
 */

export const C2PA_PACKAGE = '@contentauth/c2pa-node';
export const C2PA_VERSION = '0.10.0';
export const ORT_PACKAGE = 'onnxruntime-node';
export const ORT_VERSION = '1.31.1';

const log = (msg: string) => process.stderr.write(`[is-it-real] ${msg}\n`);

/** A usable folder setting: set, absolute, and not an unsubstituted `${...}` placeholder. */
const usable = (v: string | undefined): v is string =>
  v !== undefined && v !== '' && !v.includes('${') && isAbsolute(v);

export function dataDir(env: NodeJS.ProcessEnv = process.env): string {
  if (usable(env['ISITREAL_DATA'])) return env['ISITREAL_DATA'];
  if (usable(env['CLAUDE_PLUGIN_DATA'])) return env['CLAUDE_PLUGIN_DATA'];
  return join(homedir(), '.is-it-real');
}

function installedVersion(dir: string, pkg: string): string | null {
  try {
    const json = JSON.parse(
      readFileSync(join(dir, 'node_modules', pkg, 'package.json'), 'utf8'),
    ) as { version?: string };
    return json.version ?? null;
  } catch {
    return null;
  }
}

/** Runs `npm install pkg@version` into `dir`. npm's output goes to stderr: stdout belongs to MCP. */
function npmInstall(dir: string, spec: string): Promise<boolean> {
  mkdirSync(dir, { recursive: true });
  return new Promise((resolve) => {
    log(`installing ${spec} into ${dir} (first use only)...`);
    const child = spawn(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['install', '--no-audit', '--no-fund', '--omit=dev', '--prefix', dir, spec],
      { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' },
    );
    child.stdout.on('data', (d: Buffer) => process.stderr.write(d));
    child.stderr.on('data', (d: Buffer) => process.stderr.write(d));
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

async function importFrom(dir: string, pkg: string): Promise<unknown> {
  const require = createRequire(join(dir, 'package.json'));
  return import(pathToFileURL(require.resolve(pkg)).href);
}

/** Loads a package from the data folder, installing the pinned version if needed. */
async function ensurePackage(
  dir: string,
  pkg: string,
  version: string,
  autoInstall: boolean,
): Promise<unknown | null> {
  if (installedVersion(dir, pkg) !== version) {
    if (!autoInstall) return null;
    if (!(await npmInstall(dir, `${pkg}@${version}`))) {
      log(`could not install ${pkg}; continuing without it`);
      return null;
    }
  }
  try {
    return await importFrom(dir, pkg);
  } catch (err) {
    log(`could not load ${pkg}: ${String(err)}`);
    return null;
  }
}

export interface LoadSettings {
  dataDir: string;
  /** Folder holding C2PA-TRUST-LIST.pem. */
  trustDir: string;
  autoInstall: boolean;
  gpt2ModelPath?: string | undefined;
  /** Tests: load the library from an existing node_modules instead of the data folder. */
  c2paFrom?: string | undefined;
}

export function lazyC2pa(settings: LoadSettings): () => Promise<C2paReader | null> {
  let pending: Promise<C2paReader | null> | null = null;
  return () =>
    (pending ??= (async () => {
      const lib = (await ensurePackage(
        settings.c2paFrom ?? settings.dataDir,
        C2PA_PACKAGE,
        C2PA_VERSION,
        settings.c2paFrom === undefined && settings.autoInstall,
      )) as C2paLibrary | null;
      if (lib === null) return null;
      const trustFile = join(settings.trustDir, 'C2PA-TRUST-LIST.pem');
      const trustAnchorsPem = existsSync(trustFile) ? readFileSync(trustFile, 'utf8') : undefined;
      if (trustAnchorsPem === undefined)
        log('trust list not found; every signer will show as not recognised');
      return createC2paReaderWith(lib, trustAnchorsPem === undefined ? {} : { trustAnchorsPem });
    })());
}

export async function loadLanguageModel(settings: LoadSettings): Promise<LanguageModel | null> {
  const path = settings.gpt2ModelPath;
  if (path === undefined || path === '') return null;
  if (!existsSync(path)) {
    log(`ISITREAL_GPT2_MODEL is set but ${path} does not exist; deep text check disabled`);
    return null;
  }
  const ort = (await ensurePackage(
    settings.dataDir,
    ORT_PACKAGE,
    ORT_VERSION,
    settings.autoInstall,
  )) as OrtLibrary | null;
  if (ort === null) return null;
  try {
    return await loadGpt2With(ort, path, { verify: true });
  } catch (err) {
    log(`could not load ${GPT2_ZOO.file}: ${String(err)}`);
    return null;
  }
}
