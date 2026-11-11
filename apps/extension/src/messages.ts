import type { ItemResult, ScamSummary } from '@isitreal/core';
import type { CaptureProblem } from './content/videos.js';
import type { PackedFrame } from './shared/raw-frame.js';

/** What the content script collects from a page. Read-only; nothing is sent off the computer. */
export interface PageData {
  url: string;
  title: string;
  /** Main text of the page. */
  text: string;
  links: { text: string; href: string }[];
  /** The largest visible images, largest first, with the short texts shown next to each. */
  images: { url: string; labels: string[] }[];
  /** The largest videos, largest first. */
  videos: PageVideo[];
  /** Short texts anywhere on the page that may be the site's own AI labels. */
  pageLabels: string[];
  /** Images that could not be passed on (for example images the page drew itself). */
  skippedImages: number;
}

/** A video on the page: which frame of the page it is in, and its number there (largest first). */
export interface VideoRef {
  frameId: number;
  index: number;
}

export interface PageVideo extends VideoRef {
  /** The video file's address; missing or `blob:` for streamed video. */
  url?: string;
  labels: string[];
  /** Size on screen in pixels (width x height), to find the main video. */
  area: number;
}

/** One checked item as the side panel shows it. */
export interface PanelItem extends ItemResult {
  /** A small copy of the picture (a data: address) to show next to the result. */
  preview?: string;
  /** For a video whose frames were not looked at: where it is, so it can be watched while it plays. */
  watch?: VideoRef & { labels: string[] };
}

export interface PanelResult {
  url: string;
  scam: ScamSummary;
  items: PanelItem[];
  /** Which checks could run. The panel says so when one could not. */
  checks: { contentCredentials: boolean; pictureModel: boolean };
  /** Images on the page beyond the limit per check. */
  notChecked: number;
  engine: string;
}

/** The picture check's model files: not downloaded, on their way, ready to use, or the download failed. */
export type ModelsState =
  | { state: 'absent' }
  | { state: 'downloading'; done: number; total: number }
  | { state: 'ready' }
  | { state: 'failed'; detail?: string };

/** The numbers behind one picture's verdict (for tests and for people who want the details). */
export interface PictureScore {
  width: number;
  height: number;
  /** Photo-gate score: near 1 for plain photos. */
  gate: number;
  /** Raw picture-model score: higher is more AI-like. */
  raw: number;
  /** For a video frame: where in the video it is, in seconds. */
  time?: number;
}

/** Side panel or background -> engine (the hidden extension page), over a port named ENGINE_PORT. */
export type EngineRequest =
  | { type: 'check-page'; page: PageData }
  /** One picture, chosen with a right-click. */
  | { type: 'check-picture'; url: string; pageUrl: string }
  | { type: 'models-status' }
  /** `baseUrl` (developers and tests): fetch the files from this folder; the checksum still applies. */
  | { type: 'install-models'; baseUrl?: string }
  | { type: 'score-picture'; url: string }
  | { type: 'score-video'; url: string }
  /** One frame of a playing video, sent before `check-video-frames`. */
  | { type: 'video-frame'; frame: PackedFrame }
  /** Judge the frames sent so far, with the labels shown next to the video. */
  | { type: 'check-video-frames'; pageUrl: string; labels: string[] };
export type EngineEvent =
  | { type: 'progress'; done: number; total: number }
  | { type: 'result'; result: PanelResult }
  | { type: 'picture-result'; item: PanelItem; checks: PanelResult['checks'] }
  | { type: 'models'; models: ModelsState }
  | { type: 'score'; score: PictureScore | null }
  | { type: 'video-score'; frames: PictureScore[] | null }
  | { type: 'video-result'; item: PanelItem }
  | { type: 'error'; message: string };

export const ENGINE_PORT = 'isitreal-engine';

/** What the quiet background check looks at: text and links only. No pictures are fetched. */
export type QuickPage = Pick<PageData, 'url' | 'text' | 'links' | 'pageLabels'>;

/** Extension page or content script -> background service worker. */
export type BackgroundRequest =
  | { type: 'ensure-engine' }
  /** From the page reader, once per page: set the toolbar badge from the cheap checks. */
  | { type: 'quick-scan'; page: QuickPage };

/**
 * A picture the person right-clicked and asked about. The background part leaves it in session
 * storage (kept in memory only) and opens the side panel, which picks it up.
 */
export const PENDING_PICTURE = 'pendingPicture';
export interface PendingPicture {
  url: string;
  pageUrl: string;
  /** When it was asked (milliseconds), so a stale request is not run later. */
  at: number;
}

/** Setting (chrome.storage.local): quiet checks while browsing. On unless set to false. */
export const SETTING_BACKGROUND = 'backgroundMode';
/** Extension page -> content script in one frame of a tab. */
export type ContentRequest = { type: 'extract-page' } | { type: 'list-videos' };
export type ContentAnswer =
  | { ok: true; page: PageData }
  | { ok: true; videos: Omit<PageVideo, 'frameId'>[] }
  | { ok: false; error: string };

/** Side panel <-> content script, over a port named CAPTURE_PORT: watch a playing video. */
export const CAPTURE_PORT = 'isitreal-capture';
export type CaptureRequest = { type: 'start'; index: number; count: number };
export type CaptureEvent =
  { type: 'frame'; frame: PackedFrame; count: number } | { type: 'done'; problem?: CaptureProblem };
