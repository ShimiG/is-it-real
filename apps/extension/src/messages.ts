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
  /** Address of the picture, for a small preview next to the result. */
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

/** Side panel or background -> engine (the hidden extension page), over a port named ENGINE_PORT. */
export type EngineRequest = { type: 'check-page'; page: PageData };
export type EngineEvent =
  | { type: 'progress'; done: number; total: number }
  | { type: 'result'; result: PanelResult }
  | { type: 'error'; message: string };

export const ENGINE_PORT = 'isitreal-engine';

/** Extension page -> background service worker. */
export type BackgroundRequest = { type: 'ensure-engine' };
/** Extension page or background -> content script in a tab. */
export type ContentRequest = { type: 'extract-page' };
