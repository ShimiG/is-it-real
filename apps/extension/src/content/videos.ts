import { packFrame, rawFrameOf, type PackedFrame } from '../shared/raw-frame.js';

/** Smaller players are previews and adverts in a corner, not the video being watched. */
const MIN_SIDE = 128;

/** A video that is actually running right now. */
export const isPlaying = (video: HTMLVideoElement): boolean =>
  !video.paused && !video.ended && video.readyState >= 2;

/** How much of a box is inside the window (in square pixels). */
function areaOnScreen(rect: DOMRect, view: Window): number {
  const width = Math.min(rect.right, view.innerWidth) - Math.max(rect.left, 0);
  const height = Math.min(rect.bottom, view.innerHeight) - Math.max(rect.top, 0);
  return width > 0 && height > 0 ? width * height : 0;
}

/**
 * The videos in this frame of the page, the one being watched first: most of it on screen, then
 * playing before paused, then largest. The order is the video's number. Reel and short-video
 * pages keep the next clips loaded but paused, at the same size, just outside the window.
 */
export function visibleVideos(doc: Document = document): HTMLVideoElement[] {
  const view = doc.defaultView ?? window;
  return [...doc.querySelectorAll('video')]
    .map((video) => {
      const rect = video.getBoundingClientRect();
      return { video, rect, shown: areaOnScreen(rect, view) };
    })
    .filter(({ rect }) => rect.width >= MIN_SIDE && rect.height >= MIN_SIDE)
    .sort(
      (a, b) =>
        b.shown - a.shown ||
        Number(isPlaying(b.video)) - Number(isPlaying(a.video)) ||
        b.rect.width * b.rect.height - a.rect.width * a.rect.height,
    )
    .map(({ video }) => video);
}

/**
 * The video to watch for a "check this video while it plays" request. The page may have changed
 * since it was checked (the person scrolled to the next clip), so the number is only a first
 * guess: if that video is not running and another one is, the running one is meant.
 */
export function videoToWatch(
  index: number,
  doc: Document = document,
): HTMLVideoElement | undefined {
  const videos = visibleVideos(doc);
  const asked = videos[index];
  if (asked !== undefined && isPlaying(asked)) return asked;
  return videos.find(isPlaying) ?? asked;
}

/** The address of a video, if it has one. Streamed video has a `blob:` address or none. */
export function videoAddress(video: HTMLVideoElement): string | undefined {
  return (
    video.currentSrc ||
    video.src ||
    video.querySelector<HTMLSourceElement>('source[src]')?.src ||
    undefined
  );
}

export type CaptureProblem =
  /** The video is not playing, so there are no new frames to look at. */
  | 'paused'
  /** The browser does not allow reading this video's picture (protected or cross-site video). */
  | 'protected'
  /** The video is not in a layout the checks can read. */
  | 'unsupported'
  | 'gone';

export interface CaptureEvents {
  frame(frame: PackedFrame, count: number): void;
  done(problem?: CaptureProblem): void;
}

/** Seconds of video between two frames that are looked at. */
export const FRAME_SPACING_S = 1;
/** Give up waiting for a paused video after this long. */
const STALL_MS = 4_000;
const POLL_MS = 200;
const TOTAL_MS = 40_000;

/**
 * Watches a playing video and hands over `count` frames, at least a second of video apart.
 * It only looks: it does not play, pause or seek the video. Returns a function that stops it.
 */
export function captureFrames(
  video: HTMLVideoElement,
  count: number,
  events: CaptureEvents,
): () => void {
  let stopped = false;
  let taken = 0;
  let lastTime = Number.NEGATIVE_INFINITY;
  let lastProgress = Date.now();
  let seenTime = video.currentTime;
  const started = Date.now();
  const finish = (problem?: CaptureProblem) => {
    if (stopped) return;
    stopped = true;
    events.done(problem);
  };
  const tick = async () => {
    if (stopped) return;
    if (!video.isConnected) return finish('gone');
    const now = video.currentTime;
    if (now !== seenTime) {
      seenTime = now;
      lastProgress = Date.now();
    }
    if (video.readyState >= 2 && Math.abs(now - lastTime) >= FRAME_SPACING_S) {
      try {
        const raw = await rawFrameOf(video);
        if (stopped) return;
        if (raw === null) return finish('unsupported');
        lastTime = now;
        taken++;
        events.frame(packFrame(raw), taken);
        if (taken >= count) return finish();
      } catch {
        return finish('protected');
      }
    }
    if (Date.now() - lastProgress > STALL_MS || Date.now() - started > TOTAL_MS)
      return finish(taken >= count ? undefined : 'paused');
    setTimeout(() => void tick(), POLL_MS);
  };
  void tick();
  return () => {
    stopped = true;
  };
}
