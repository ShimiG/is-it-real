import type { ItemResult, ScamSummary } from '@isitreal/core';

/** What the content script collects from a page. Read-only; nothing is sent off the computer. */
export interface PageData {
  url: string;
  title: string;
  /** Main text of the page. */
  text: string;
  links: { text: string; href: string }[];
  /** The largest visible images, largest first, with the short texts shown next to each. */
  images: { url: string; labels: string[] }[];
  videos: { url?: string; labels: string[] }[];
  /** Short texts anywhere on the page that may be the site's own AI labels. */
  pageLabels: string[];
  /** Images that could not be passed on (for example images the page drew itself). */
  skippedImages: number;
}

/** One checked item as the side panel shows it. */
export interface PanelItem extends ItemResult {
  /** A small copy of the picture (a data: address) to show next to the result. */
  preview?: string;
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
}

/** Side panel or background -> engine (the hidden extension page), over a port named ENGINE_PORT. */
export type EngineRequest =
  | { type: 'check-page'; page: PageData }
  | { type: 'models-status' }
  /** `baseUrl` (developers and tests): fetch the files from this folder; the checksum still applies. */
  | { type: 'install-models'; baseUrl?: string }
  | { type: 'score-picture'; url: string };
export type EngineEvent =
  | { type: 'progress'; done: number; total: number }
  | { type: 'result'; result: PanelResult }
  | { type: 'models'; models: ModelsState }
  | { type: 'score'; score: PictureScore | null }
  | { type: 'error'; message: string };

export const ENGINE_PORT = 'isitreal-engine';

/** Extension page -> background service worker. */
export type BackgroundRequest = { type: 'ensure-engine' };
/** Extension page or background -> content script in a tab. */
export type ContentRequest = { type: 'extract-page' };
