import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, renameSync, rmSync } from 'node:fs';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  IMAGE_CLASSIFIER_MODEL,
  PHOTO_GATE_MODEL,
  VIDEO_FRAMES_MODEL,
  photoLikeScore,
  type C2paReader,
  type ImageClassifierModel,
  type ImageStatisticalCheck,
  type LanguageModel,
  type PhotoGateModel,
  type VideoFramesModel,
} from '@isitreal/core';
import { createC2paReaderWith, type C2paLibrary } from '@isitreal/c2pa-node/reader';
import { loadImageClassifierWith, loadImageEmbedderWith } from '@isitreal/image-node/classifier';
import { decodeImageWith, type SharpLibrary } from '@isitreal/image-node/decode';
import { GPT2_ZOO, loadGpt2With, type OrtLibrary } from '@isitreal/lm-node/gpt2';
import { extractFrames, ffmpegWorks } from '@isitreal/video-node/ffmpeg';
import type { VideoCheck } from './tools.js';

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
export const FFMPEG_PACKAGE = 'ffmpeg-static';
export const FFMPEG_VERSION = '5.3.0';

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
  // ffmpeg reads video frames. One already on the computer is used; otherwise a packaged one.
  if (settings.video && settings.imageModel && settings.ffmpegPath === undefined)
    want.push([FFMPEG_PACKAGE, FFMPEG_VERSION]);
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
  /** Tests: use this photo-gate encoder file instead of downloading. */
  gateModelPath?: string | undefined;
  /** Video frame check (experimental). On unless switched off; needs the picture check. */
  video: boolean;
  /** An ffmpeg program to use; when unset, a packaged one is installed into the data folder. */
  ffmpegPath?: string | undefined;
}

/** `ffmpeg` already on this computer (on the PATH), if it runs. */
export function systemFfmpeg(): string | undefined {
  try {
    const r = spawnSync('ffmpeg', ['-hide_banner', '-version'], { timeout: 10_000 });
    return r.status === 0 ? 'ffmpeg' : undefined;
  } catch {
    return undefined;
  }
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

/** A model file in the data folder: downloaded and checked on first use. Null when unavailable. */
async function modelFile(
  settings: LoadSettings,
  spec: { file: string; url: string; sha256: string; bytes: number },
): Promise<string | null> {
  const dir = join(settings.dataDir, 'models');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, spec.file);
  if (existsSync(path)) return path;
  if (!settings.autoInstall) return null;
  return (await downloadVerified(spec.url, path, spec.sha256, spec.bytes)) ? path : null;
}

/**
 * The picture check: decoder (sharp), runner (onnxruntime-node) and two model files, all set up in
 * the data folder on first use: the photo gate's image encoder (about 180 MB) and the picture model
 * (about 45 MB), plus the two libraries. The gate decides whether an image is photo-like; only
 * those are judged by the picture model. Null when switched off or when setup fails; images then
 * get the provenance checks only.
 */
export function lazyImageCheck(
  settings: LoadSettings,
  model: ImageClassifierModel = IMAGE_CLASSIFIER_MODEL,
  gateModel: PhotoGateModel = PHOTO_GATE_MODEL,
): () => Promise<ImageStatisticalCheck | null> {
  let pending: Promise<ImageStatisticalCheck | null> | null = null;
  return () =>
    (pending ??= (async () => {
      if (
        !settings.imageModel ||
        model.calibration.length === 0 ||
        gateModel.logistic.weights.length === 0
      )
        return null;
      const from = settings.nativeFrom ?? settings.dataDir;
      if (settings.nativeFrom === undefined) await ensureInstalled(settings);
      const ort = (await loadPackage(from, ORT_PACKAGE, ORT_VERSION)) as OrtLibrary | null;
      const sharpModule = (await loadPackage(from, SHARP_PACKAGE, SHARP_VERSION)) as
        { default?: SharpLibrary } | SharpLibrary | null;
      if (ort === null || sharpModule === null) return null;
      const sharp = (
        typeof sharpModule === 'function' ? sharpModule : sharpModule.default
      ) as SharpLibrary;
      const path = settings.imageModelPath ?? (await modelFile(settings, model));
      const gatePath = settings.gateModelPath ?? (await modelFile(settings, gateModel));
      if (path === null || gatePath === null) return null;
      try {
        const runner = await loadImageClassifierWith(ort, model.runnerId, path);
        const gate = {
          runner: await loadImageEmbedderWith(ort, gateModel.runnerId, gatePath),
          model: gateModel,
        };
        const decode = decodeImageWith(sharp);
        // Try both once, so a broken install is noticed here rather than on a user's image.
        await runner.run(new Float32Array(3 * model.cropSize * model.cropSize), model.cropSize);
        const side = Math.max(model.minSide, 32);
        await photoLikeScore(
          { width: side, height: side, data: new Uint8ClampedArray(side * side * 4) },
          gate,
        );
        return { decode, gate, runner, model };
      } catch (err) {
        log(`could not load the picture-checking models: ${String(err)}`);
        return null;
      }
    })());
}

/**
 * The experimental video frame check: the picture check (gate and model) plus ffmpeg to read
 * frames. Null when switched off, when the picture check is unavailable, when no ffmpeg can be
 * found or installed, or when the frame calibration is missing; videos then get the provenance
 * checks only.
 */
export function lazyVideoCheck(
  settings: LoadSettings,
  imageCheck: () => Promise<ImageStatisticalCheck | null>,
  model: VideoFramesModel = VIDEO_FRAMES_MODEL,
): () => Promise<VideoCheck | null> {
  let pending: Promise<VideoCheck | null> | null = null;
  return () =>
    (pending ??= (async () => {
      if (!settings.video || model.calibration.length === 0) return null;
      const image = await imageCheck();
      if (image === null) return null;
      if (image.model.id !== model.imageModelId || image.gate.model.id !== model.gateId) {
        log(`the video calibration ${model.id} does not match the picture model; video check off`);
        return null;
      }
      let ffmpeg = settings.ffmpegPath;
      if (ffmpeg === undefined) {
        await ensureInstalled(settings);
        const pkg = (await loadPackage(settings.dataDir, FFMPEG_PACKAGE, FFMPEG_VERSION)) as {
          default?: string | null;
        } | null;
        ffmpeg = pkg?.default ?? undefined;
      }
      if (ffmpeg === undefined || !(await ffmpegWorks(ffmpeg))) {
        log('no working ffmpeg found; video frames will not be checked');
        return null;
      }
      const program = ffmpeg;
      return {
        frameCheck: {
          gate: image.gate,
          runner: image.runner,
          imageModel: image.model,
          model,
        },
        extractFrames: (file, count) => extractFrames(program, file, count),
      };
    })());
}
