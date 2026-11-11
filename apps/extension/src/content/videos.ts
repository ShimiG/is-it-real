import { packFrame, rawFrameOf, type PackedFrame } from '../shared/raw-frame.js';

/** Smaller players are previews and adverts in a corner, not the video being watched. */
const MIN_SIDE = 128;

/** The videos shown in this frame of the page, largest first. The order is the video's number. */
export function visibleVideos(doc: Document = document): HTMLVideoElement[] {
  return [...doc.querySelectorAll('video')]
    .map((video) => ({ video, rect: video.getBoundingClientRect() }))
    .filter(({ rect }) => rect.width >= MIN_SIDE && rect.height >= MIN_SIDE)
    .sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height)
    .map(({ video }) => video);
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
