import type { PageData, PageVideo } from '../messages.js';
import { videoAddress, visibleVideos } from './videos.js';

/**
 * Collects what the checks need from the page in front of the user: its main text, links, the
 * largest visible images and videos, and the short texts next to them (where sites put their own
 * "AI" labels). Read-only: it changes nothing on the page and sends nothing anywhere.
 *
 * The same rules as the Claude plugin's page script (plugin/skills/check-this-page/extract-page.js).
 */
export const MAX_TEXT = 20_000;
export const MAX_LINKS = 200;
export const MAX_IMAGES = 12;
export const MAX_VIDEOS = 2;
/** Smaller pictures are icons and buttons, not content. */
export const MIN_SIDE = 128;
/** A picture shown smaller than this on the page is treated as an icon, whatever its file size. */
export const MIN_SHOWN = 48;
const SHORT = 60;
const LABEL_WORDS = /\b(ai|a\.i\.|synthetic|generated|imagined|content credentials|altered)\b/i;

const clean = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

function shortTexts(root: Element): string[] {
  const out = new Set<string>();
  for (const el of [root, ...root.querySelectorAll('*')]) {
    for (const attr of ['alt', 'aria-label', 'title']) {
      const v = clean(el.getAttribute(attr));
      if (v !== '' && v.length <= SHORT) out.add(v);
    }
    if (el.childElementCount === 0) {
      const v = clean(el.textContent);
      if (v !== '' && v.length <= SHORT) out.add(v);
    }
    if (out.size >= 20) break;
  }
  return [...out];
}

const boxOf = (el: Element): Element =>
  el.closest('figure, article, [role="article"], div') ?? el.parentElement ?? el;

/** The largest videos in this frame of the page, with the short texts shown next to each. */
export function listVideos(doc: Document = document): Omit<PageVideo, 'frameId'>[] {
  return visibleVideos(doc)
    .slice(0, MAX_VIDEOS)
    .map((v, index) => {
      const url = videoAddress(v);
      const rect = v.getBoundingClientRect();
      return {
        ...(url === undefined ? {} : { url }),
        labels: shortTexts(boxOf(v)).slice(0, 12),
        index,
        area: Math.round(rect.width * rect.height),
      };
    });
}

export function extractPage(doc: Document = document): PageData {
  const main = doc.querySelector<HTMLElement>('article, main, [role="main"]') ?? doc.body;
  const text = clean(main?.innerText).slice(0, MAX_TEXT);

  const links: PageData['links'] = [];
  for (const a of doc.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    if (links.length >= MAX_LINKS) break;
    if (!/^https?:/.test(a.href)) continue;
    const t = clean(a.innerText || a.getAttribute('aria-label')).slice(0, 200);
    if (t !== '') links.push({ text: t, href: a.href });
  }

  let skippedImages = 0;
  const seen = new Set<string>();
  const images = [...doc.images]
    .filter((img) => img.naturalWidth >= MIN_SIDE && img.naturalHeight >= MIN_SIDE)
    .filter((img) => {
      const r = img.getBoundingClientRect();
      return r.width >= MIN_SHOWN && r.height >= MIN_SHOWN;
    })
    .sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight)
    .filter((img) => {
      const url = img.currentSrc || img.src;
      if (seen.has(url)) return false;
      seen.add(url);
      const ok = /^(https?:|data:image\/)/.test(url);
      if (!ok) skippedImages++;
      return ok;
    })
    .map((img) => ({
      url: img.currentSrc || img.src,
      labels: shortTexts(boxOf(img)).slice(0, 12),
    }));

  // A streamed video has a blob: address that cannot be fetched as a file; it is still passed
  // on, because labels shown next to it count and its frames can be read while it plays.
  const videos = listVideos(doc).map((v) => ({ ...v, frameId: 0 }));

  const pageLabels = doc.body ? shortTexts(doc.body).filter((s) => LABEL_WORDS.test(s)) : [];
  for (const el of doc.querySelectorAll('[aria-label]')) {
    const v = clean(el.getAttribute('aria-label'));
    if (v.length <= SHORT && LABEL_WORDS.test(v) && !pageLabels.includes(v)) pageLabels.push(v);
  }

  return {
    url: doc.location.href,
    title: clean(doc.title).slice(0, 200),
    text,
    links,
    images,
    videos,
    pageLabels: pageLabels.slice(0, 50),
    skippedImages,
  };
}
