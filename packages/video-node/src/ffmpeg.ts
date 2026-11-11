import { spawn } from 'node:child_process';
import { open } from 'node:fs/promises';
import { detectVideoFormat, type Pixels, type VideoFormat } from '@isitreal/core';

/**
 * Reads frames from a video file with ffmpeg, run as a separate program.
 *
 * ffmpeg parses untrusted files, so it is kept on a short leash:
 * - the container type is decided from the file's first bytes (MP4, MOV, WebM / Matroska only)
 *   and ffmpeg is told to use exactly that reader, so a playlist or script renamed ".mp4" is
 *   never interpreted;
 * - it may only open local files, has no terminal input, and is killed after a time limit;
 * - output size is capped before it is decoded.
 * Frames come out as BMP on a pipe; nothing is written to disk.
 *
 * The evaluation (eval/reference/video_eval.py) uses the same ffmpeg arguments, so the shipped
 * check sees the same pixels as the measurements.
 */

/** Refuse frames larger than this (width x height). */
export const MAX_FRAME_PIXELS = 40_000_000;
const DEMUXER: Record<Exclude<VideoFormat, 'unknown'>, string> = {
  mp4: 'mov',
  mov: 'mov',
  webm: 'matroska',
};

export interface FfmpegOptions {
  /** Time limit for each ffmpeg run, in milliseconds. */
  timeoutMs?: number;
}

interface RunResult {
  code: number | null;
  stdout: Buffer;
  stderr: string;
}

function run(
  ffmpeg: string,
  args: string[],
  maxStdout: number,
  timeoutMs: number,
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const chunks: Buffer[] = [];
    let size = 0;
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d: Buffer) => {
      size += d.length;
      if (size > maxStdout) child.kill('SIGKILL');
      else chunks.push(d);
    });
    child.stderr.on('data', (d: Buffer) => {
      if (stderr.length < 65_536) stderr += d.toString('latin1');
    });
    const done = (code: number | null) => {
      clearTimeout(timer);
      resolve({ code, stdout: size > maxStdout ? Buffer.alloc(0) : Buffer.concat(chunks), stderr });
    };
    child.on('error', () => done(null));
    child.on('close', done);
  });
}

/** True when `ffmpeg` can be started and reports a version. */
export async function ffmpegWorks(ffmpeg: string): Promise<boolean> {
  const r = await run(ffmpeg, ['-hide_banner', '-version'], 65_536, 10_000);
  return r.code === 0 && /^ffmpeg version/m.test(r.stdout.toString('latin1'));
}

/** The container type of a file, from its first bytes. */
export async function videoFormatOf(file: string): Promise<VideoFormat> {
  try {
    const handle = await open(file, 'r');
    try {
      const head = new Uint8Array(16);
      const { bytesRead } = await handle.read(head, 0, 16, 0);
      return detectVideoFormat(head.subarray(0, bytesRead));
    } finally {
      await handle.close();
    }
  } catch {
    return 'unknown';
  }
}

const inputArgs = (file: string, format: Exclude<VideoFormat, 'unknown'>) => [
  '-protocol_whitelist',
  'file',
  '-f',
  DEMUXER[format],
  '-i',
  file,
];

/** Length of the video in seconds; null when the file is not a readable video. */
export async function videoDuration(
  ffmpeg: string,
  file: string,
  opts: FfmpegOptions = {},
): Promise<number | null> {
  const format = await videoFormatOf(file);
  if (format === 'unknown') return null;
  // With no output given ffmpeg prints what it found and exits; that is all that is needed.
  const r = await run(
    ffmpeg,
    ['-hide_banner', '-nostdin', ...inputArgs(file, format)],
    1024,
    opts.timeoutMs ?? 20_000,
  );
  if (!/Stream #\d+:\d+.*: Video:/.test(r.stderr)) return null;
  const m = /Duration: (\d+):(\d\d):(\d\d(?:\.\d+)?)/.exec(r.stderr);
  if (m === null) return null;
  const seconds = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  return seconds > 0 ? seconds : null;
}

/** Decodes the BMP that ffmpeg writes (24-bit, uncompressed) into RGBA pixels. */
export function decodeBmp(buf: Uint8Array): Pixels | null {
  if (buf.length < 54 || buf[0] !== 0x42 || buf[1] !== 0x4d) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const offset = view.getUint32(10, true);
  const width = view.getInt32(18, true);
  const rawHeight = view.getInt32(22, true);
  const height = Math.abs(rawHeight);
  if (view.getUint16(28, true) !== 24 || view.getUint32(30, true) !== 0) return null;
  if (width <= 0 || height <= 0 || width * height > MAX_FRAME_PIXELS) return null;
  const stride = (width * 3 + 3) & ~3;
  if (offset + stride * height > buf.length) return null;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    // Rows are stored bottom-up unless the height is negative.
    let src = offset + (rawHeight > 0 ? height - 1 - y : y) * stride;
    let dst = y * width * 4;
    for (let x = 0; x < width; x++, src += 3, dst += 4) {
      data[dst] = buf[src + 2]!;
      data[dst + 1] = buf[src + 1]!;
      data[dst + 2] = buf[src]!;
      data[dst + 3] = 255;
    }
  }
  return { width, height, data };
}

/** The frame shown at `seconds` into the video; null when ffmpeg gives nothing. */
export async function frameAt(
  ffmpeg: string,
  file: string,
  seconds: number,
  opts: FfmpegOptions = {},
): Promise<Pixels | null> {
  const format = await videoFormatOf(file);
  if (format === 'unknown') return null;
  const r = await run(
    ffmpeg,
    [
      '-v',
      'error',
      '-nostdin',
      '-ss',
      seconds.toFixed(3),
      ...inputArgs(file, format),
      '-frames:v',
      '1',
      '-f',
      'image2pipe',
      '-vcodec',
      'bmp',
      '-pix_fmt',
      'bgr24',
      '-',
    ],
    MAX_FRAME_PIXELS * 3 + 4096,
    opts.timeoutMs ?? 30_000,
  );
  return r.stdout.length === 0 ? null : decodeBmp(r.stdout);
}

/**
 * `count` frames spread evenly over the video: frame k is taken at (k + 0.5) / count of the
 * duration. Returns fewer frames when some cannot be read, and none for an unreadable file.
 */
export async function extractFrames(
  ffmpeg: string,
  file: string,
  count: number,
  opts: FfmpegOptions = {},
): Promise<Pixels[]> {
  const duration = await videoDuration(ffmpeg, file, opts);
  if (duration === null) return [];
  const frames: Pixels[] = [];
  for (let k = 0; k < count; k++) {
    const frame = await frameAt(ffmpeg, file, (duration * (k + 0.5)) / count, opts);
    if (frame !== null) frames.push(frame);
  }
  return frames;
}
