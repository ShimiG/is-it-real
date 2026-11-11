import { VIDEO_MIME, detectVideoFormat, yuv420ToPixels, type Pixels } from '@isitreal/core';
import { rawFrameOf } from '../shared/raw-frame.js';

/**
 * Video files in the engine page: fetched like pictures (the original file, so its labels and
 * signature can be read), and decoded by the browser's own video player to get still frames.
 * The same sampling as the plugin and the evaluation: frame k of `count` is taken at
 * (k + 0.5) / count of the duration.
 *
 * Frames are NOT read through a canvas. A canvas gives the browser's own idea of RGB, which
 * differs between browsers and graphics cards and moves the picture model's score by a point or
 * two. Instead the decoder's raw planes are copied out (WebCodecs) and converted by the core's
 * one fixed rule, exactly as the plugin and the evaluation do (packages/core/src/video/yuv.ts).
 */
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export const VIDEO_FETCH_TIMEOUT_MS = 60_000;
const STEP_TIMEOUT_MS = 15_000;

/** A video address that can be fetched as one file (not a stream delivered in pieces). */
const isVideoFileUrl = (url: string | undefined): url is string =>
  url !== undefined && /^https?:/i.test(url) && !/\.(m3u8|mpd)(\?|#|$)/i.test(url);

export async function fetchVideoBytes(url: string): Promise<Uint8Array> {
  if (!isVideoFileUrl(url)) throw new Error('not a video file address');
  const res = await fetch(url, {
    cache: 'force-cache',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(VIDEO_FETCH_TIMEOUT_MS),
  });
  if (!res.ok || res.body === null) throw new Error(`HTTP ${res.status}`);
  if (Number(res.headers.get('content-length') ?? '0') > MAX_VIDEO_BYTES)
    throw new Error('too large');
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_VIDEO_BYTES) {
      await reader.cancel();
      throw new Error('too large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
}

function once(target: EventTarget, name: string, failOn: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => done(() => reject(new Error(`timeout waiting for ${name}`))),
      STEP_TIMEOUT_MS,
    );
    const ok = () => done(resolve);
    const bad = () => done(() => reject(new Error(failOn)));
    const done = (finish: () => void) => {
      clearTimeout(timer);
      target.removeEventListener(name, ok);
      target.removeEventListener(failOn, bad);
      finish();
    };
    target.addEventListener(name, ok);
    target.addEventListener(failOn, bad);
  });
}

/** A frame of a video file: its pixels and where in the video it is (seconds). */
export interface TimedFrame {
  pixels: Pixels;
  time: number;
}

/** Still frames spread evenly over a video file. Empty when the browser cannot play the file. */
export async function framesFromVideoFile(
  bytes: Uint8Array,
  count: number,
  onProblem: (what: string) => void = () => {},
): Promise<TimedFrame[]> {
  const format = detectVideoFormat(bytes);
  if (format === 'unknown') return [];
  const address = URL.createObjectURL(
    new Blob([bytes as Uint8Array<ArrayBuffer>], { type: VIDEO_MIME[format] ?? 'video/mp4' }),
  );
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  const frames: TimedFrame[] = [];
  try {
    video.src = address;
    await once(video, 'loadeddata', 'error');
    const { duration } = video;
    if (!Number.isFinite(duration) || duration <= 0) return [];
    for (let k = 0; k < count; k++) {
      try {
        const seeked = once(video, 'seeked', 'error');
        video.currentTime = ((k + 0.5) / count) * duration;
        await seeked;
        const raw = await rawFrameOf(video);
        if (raw === null) onProblem(`frame ${k}: not 8-bit 4:2:0 video, or too large`);
        else frames.push({ pixels: yuv420ToPixels(raw), time: raw.time });
      } catch (err) {
        // A frame that cannot be read is skipped; too few frames means "not checked".
        onProblem(`frame ${k}: ${String(err)}`);
      }
    }
    return frames;
  } catch (err) {
    onProblem(
      `${String(err)}${video.error === null ? '' : ` (${video.error.code}: ${video.error.message})`}`,
    );
    return frames;
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(address);
  }
}
