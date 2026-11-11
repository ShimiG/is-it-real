import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, renameSync, rmSync } from 'node:fs';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  IMAGE_CLASSIFIER_MODEL,
  type C2paReader,
  type ImageClassifierModel,
  type ImageStatisticalCheck,
  type LanguageModel,
} from '@isitreal/core';
import { createC2paReaderWith, type C2paLibrary } from '@isitreal/c2pa-node/reader';
import { loadImageClassifierWith } from '@isitreal/image-node/classifier';
import { decodeImageWith, type SharpLibrary } from '@isitreal/image-node/decode';
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
export const SHARP_PACKAGE = 'sharp';
export const SHARP_VERSION = '0.35.5';

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

/**
 * Runs ONE `npm install` with every package spec into `dir`. Separate installs into the same folder
 * remove each other's packages (npm prunes what the folder's package.json does not list), so all
 * packages are always installed together. npm's output goes to stderr: stdout belongs to MCP.
 */
function npmInstall(dir: string, specs: string[]): Promise<boolean> {
  mkdirSync(dir, { recursive: true });
  return new Promise((resolve) => {
    log(`installing ${specs.join(', ')} into ${dir} (first use only)...`);
    const child = spawn(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['install', '--no-audit', '--no-fund', '--omit=dev', '--prefix', dir, ...specs],
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

/** Loads a package from `dir` if the pinned version is installed there. */
async function loadPackage(dir: string, pkg: string, version: string): Promise<unknown | null> {
  if (installedVersion(dir, pkg) !== version) return null;
  try {
    return await importFrom(dir, pkg);
  } catch (err) {
    log(`could not load ${pkg}: ${String(err)}`);
    return null;
  }
}

/** Packages this configuration needs in the data folder. */
function wantedPackages(settings: LoadSettings): [string, string][] {
  const want: [string, string][] = [];
  if (settings.c2paFrom === undefined) want.push([C2PA_PACKAGE, C2PA_VERSION]);
  const needsOrt =
    (settings.imageModel && settings.nativeFrom === undefined) ||
    (settings.gpt2ModelPath ?? '') !== '';
  if (needsOrt) want.push([ORT_PACKAGE, ORT_VERSION]);
  if (settings.imageModel && settings.nativeFrom === undefined)
    want.push([SHARP_PACKAGE, SHARP_VERSION]);
  return want;
}

const installs = new Map<string, Promise<void>>();

/** Installs every missing package for this configuration, once, in a single npm run. */
function ensureInstalled(settings: LoadSettings): Promise<void> {
  const key = settings.dataDir;
  let pending = installs.get(key);
  if (pending === undefined) {
    pending = (async () => {
      const want = wantedPackages(settings);
      const missing = want.filter(
        ([pkg, version]) => installedVersion(settings.dataDir, pkg) !== version,
      );
      if (missing.length === 0 || !settings.autoInstall) return;
      // Always list every wanted package, so the install keeps the ones already there.
      if (
        !(await npmInstall(
          settings.dataDir,
          want.map(([p, v]) => `${p}@${v}`),
        ))
      )
        log('could not install the native libraries; continuing without them');
    })();
    installs.set(key, pending);
  }
  return pending;
}

export interface LoadSettings {
  dataDir: string;
  /** Folder holding C2PA-TRUST-LIST.pem. */
  trustDir: string;
  autoInstall: boolean;
  gpt2ModelPath?: string | undefined;
  /** Tests: load the library from an existing node_modules instead of the data folder. */
  c2paFrom?: string | undefined;
  /** Picture check (image classifier). On unless switched off. */
  imageModel: boolean;
  /** Tests: load onnxruntime-node and sharp from here instead of the data folder. */
  nativeFrom?: string | undefined;
  /** Tests: use this model file instead of downloading. */
  imageModelPath?: string | undefined;
}

export function lazyC2pa(settings: LoadSettings): () => Promise<C2paReader | null> {
  let pending: Promise<C2paReader | null> | null = null;
  return () =>
    (pending ??= (async () => {
      if (settings.c2paFrom === undefined) await ensureInstalled(settings);
      const lib = (await loadPackage(
        settings.c2paFrom ?? settings.dataDir,
        C2PA_PACKAGE,
        C2PA_VERSION,
      )) as C2paLibrary | null;
      if (lib === null) return null;
      const trustFile = join(settings.trustDir, 'C2PA-TRUST-LIST.pem');
      const trustAnchorsPem = existsSync(trustFile) ? readFileSync(trustFile, 'utf8') : undefined;
      if (trustAnchorsPem === undefined)
        log('trust list not found; every signer will show as not recognised');
      const reader = createC2paReaderWith(
        lib,
        trustAnchorsPem === undefined ? {} : { trustAnchorsPem },
      );
      try {
        // The native part loads on first use: try it once now, so a broken install is noticed here.
        await reader.read(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), 'image/jpeg');
      } catch (err) {
        log(`the Content Credentials library is not usable: ${String(err)}`);
        return null;
      }
      return reader;
    })());
}

export async function loadLanguageModel(settings: LoadSettings): Promise<LanguageModel | null> {
  const path = settings.gpt2ModelPath;
  if (path === undefined || path === '') return null;
  if (!existsSync(path)) {
    log(`ISITREAL_GPT2_MODEL is set but ${path} does not exist; deep text check disabled`);
    return null;
  }
  await ensureInstalled(settings);
  const ort = (await loadPackage(settings.dataDir, ORT_PACKAGE, ORT_VERSION)) as OrtLibrary | null;
  if (ort === null) return null;
  try {
    return await loadGpt2With(ort, path, { verify: true });
  } catch (err) {
    log(`could not load ${GPT2_ZOO.file}: ${String(err)}`);
    return null;
  }
}

/** Downloads a file once, checking its size and sha256 before it is used. */
async function downloadVerified(
  url: string,
  dest: string,
  sha256: string,
  bytes: number,
): Promise<boolean> {
  const tmp = `${dest}.part`;
  try {
    log(`downloading ${url} (${(bytes / 1e6).toFixed(0)} MB, first use only)...`);
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok || res.body === null) throw new Error(`HTTP ${res.status}`);
    const hash = createHash('sha256');
    const file = createWriteStream(tmp);
    let total = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > bytes) throw new Error('file is larger than expected');
      hash.update(value);
      if (!file.write(value)) await new Promise<void>((r) => file.once('drain', () => r()));
    }
    await new Promise<void>((r, j) => file.end((err?: Error | null) => (err ? j(err) : r())));
    const got = hash.digest('hex');
    if (got !== sha256) throw new Error(`checksum mismatch (${got})`);
    renameSync(tmp, dest);
    return true;
  } catch (err) {
    rmSync(tmp, { force: true });
    log(`could not download the model: ${String(err)}`);
    return false;
  }
}

/**
 * The picture check: decoder (sharp), runner (onnxruntime-node) and the model file, all set up in
 * the data folder on first use (about 45 MB of model plus the two libraries). Null when switched
 * off or when setup fails; images then get the provenance checks only.
 */
export function lazyImageCheck(
  settings: LoadSettings,
  model: ImageClassifierModel = IMAGE_CLASSIFIER_MODEL,
): () => Promise<ImageStatisticalCheck | null> {
  let pending: Promise<ImageStatisticalCheck | null> | null = null;
  return () =>
    (pending ??= (async () => {
      if (!settings.imageModel || model.calibration.length === 0) return null;
      const from = settings.nativeFrom ?? settings.dataDir;
      if (settings.nativeFrom === undefined) await ensureInstalled(settings);
      const ort = (await loadPackage(from, ORT_PACKAGE, ORT_VERSION)) as OrtLibrary | null;
      const sharpModule = (await loadPackage(from, SHARP_PACKAGE, SHARP_VERSION)) as
        { default?: SharpLibrary } | SharpLibrary | null;
      if (ort === null || sharpModule === null) return null;
      const sharp = (
        typeof sharpModule === 'function' ? sharpModule : sharpModule.default
      ) as SharpLibrary;
      let path = settings.imageModelPath;
      if (path === undefined) {
        const dir = join(settings.dataDir, 'models');
        mkdirSync(dir, { recursive: true });
        path = join(dir, model.file);
        if (
          !existsSync(path) &&
          !(
            settings.autoInstall &&
            (await downloadVerified(model.url, path, model.sha256, model.bytes))
          )
        )
          return null;
      }
      try {
        const runner = await loadImageClassifierWith(ort, model.runnerId, path);
        const decode = decodeImageWith(sharp);
        // Try both once, so a broken install is noticed here rather than on a user's image.
        await runner.run(new Float32Array(3 * model.cropSize * model.cropSize), model.cropSize);
        return { decode, runner, model };
      } catch (err) {
        log(`could not load the picture-checking model: ${String(err)}`);
        return null;
      }
    })());
}
