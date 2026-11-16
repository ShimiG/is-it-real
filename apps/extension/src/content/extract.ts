import type { PageData, PageVideo, QuickPage } from '../messages.js';
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
// Words by which a site's own AI label can be recognised as a candidate (English and Hebrew).
const LABEL_WORDS =
  /\b(ai|a\.i\.|synthetic|generated|imagined|content credentials|altered)\b|בינה מלאכותית/i;

// Words by which a text may be someone saying "this was made with AI". Only candidates are
// picked here; the engine decides with the shared rules (packages/core/src/page-claims.ts).
const CLAIM_WORDS =
  /#[\w-]*(?:ai|sora|veo|midjourney|diffusion|dall|kling|runway|hailuo|luma)|\b(?:ai|a\.i\.|artificial intelligence)\b|בינה מלאכותית/i;
/** Longer texts are articles and long comments, not a caption or a tag. */
const MAX_WORDS = 300;
export const MAX_PAGE_WORDS = 30;

const clean = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

/** Elements whose text is code or hidden templates, never something a person reads. */
const NOT_TEXT = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);

/**
 * Sites where a page is about one video, so the page's title is that video's title, with the
 * uploader's own tags in it.
 */
const VIDEO_SITES =
  /(?:^|\.)(?:youtube\.com|tiktok\.com|instagram\.com|facebook\.com|x\.com|twitter\.com|vimeo\.com|dailymotion\.com)$/;

/** Addresses that are one video's own page: a label on such a page is about that video. */
const VIDEO_PAGES: [RegExp, RegExp][] = [
  [/(?:^|\.)youtube\.com$/, /^\/(?:watch|shorts\/)/],
  [/(?:^|\.)facebook\.com$/, /^\/(?:reel\/|watch|share\/[rv]\/|[^/]+\/videos\/)/],
  [/(?:^|\.)instagram\.com$/, /^\/(?:[^/]+\/)?(?:reels?|p|tv)\//],
  [/(?:^|\.)tiktok\.com$/, /\/video\//],
  [/(?:^|\.)(?:x|twitter)\.com$/, /\/status\//],
  [/(?:^|\.)threads\.(?:net|com)$/, /\/post\//],
];

export function isVideoPage(location: { hostname: string; pathname: string }): boolean {
  return VIDEO_PAGES.some(
    ([host, path]) => host.test(location.hostname) && path.test(location.pathname),
  );
}

function shortTexts(root: Element): string[] {
  const out = new Set<string>();
  for (const el of [root, ...root.querySelectorAll('*')]) {
    if (NOT_TEXT.has(el.tagName)) continue;
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
      const labels = shortTexts(boxOf(v)).slice(0, 12);
      // On a video site the page's title is the main video's title, tags included.
      const title = clean(doc.title).slice(0, 200);
      if (index === 0 && title !== '' && VIDEO_SITES.test(doc.location.hostname))
        labels.push(title);
      return {
        ...(url === undefined ? {} : { url }),
        labels,
        index,
        area: Math.round(rect.width * rect.height),
      };
    });
}

/** How many elements the label search looks at, at most (very long pages are cut off). */
const MAX_LABEL_ELEMENTS = 20_000;

/** Short texts anywhere on the page that could be the site's own AI label. */
function labelLikeTexts(doc: Document): string[] {
  const found = new Set<string>();
  if (!doc.body) return [];
  let seen = 0;
  for (const el of doc.body.querySelectorAll('*')) {
    if (++seen > MAX_LABEL_ELEMENTS || found.size >= 50) break;
    if (NOT_TEXT.has(el.tagName)) continue;
    for (const attr of ['aria-label', 'title', 'alt']) {
      const v = clean(el.getAttribute(attr));
      if (v !== '' && v.length <= SHORT && LABEL_WORDS.test(v)) found.add(v);
    }
    if (el.childElementCount === 0) {
      const v = clean(el.textContent);
      if (v !== '' && v.length <= SHORT && LABEL_WORDS.test(v)) found.add(v);
    }
  }
  return [...found];
}

/** The text an element holds itself, without the text of the elements inside it. */
const ownText = (el: Element): string =>
  clean(
    [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent)
      .join(' '),
  );

/**
 * Captions, descriptions and tags anywhere on the page that mention AI. A link's words name the
 * page it leads to (another video, another article), so they are left out; a tag ("#aislop") is
 * the exception, because that is how tags are written.
 */
export function wordsAboutAi(doc: Document = document): string[] {
  const found = new Set<string>();
  if (!doc.body) return [];
  let seen = 0;
  for (const el of doc.body.querySelectorAll('*')) {
    if (++seen > MAX_LABEL_ELEMENTS || found.size >= MAX_PAGE_WORDS) break;
    if (NOT_TEXT.has(el.tagName)) continue;
    const v = ownText(el);
    if (v === '' || v.length > MAX_WORDS || !CLAIM_WORDS.test(v)) continue;
    if (el.closest('a[href]') !== null && !/^#[^\s#]+$/.test(v)) continue;
    found.add(v);
  }
  return [...found];
}

/** Part of the box is inside the window: the person can see it now. */
const onScreen = (r: DOMRect, win: Window): boolean =>
  r.bottom > 0 && r.right > 0 && r.top < win.innerHeight && r.left < win.innerWidth;

/** The share of box `a` that box `b` covers. */
function covered(a: DOMRect, b: DOMRect): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  const area = a.width * a.height;
  return w <= 0 || h <= 0 || area <= 0 ? 0 : (w * h) / area;
}

/** What the quiet check needs: the page's text, links and label-like short texts. Nothing else is read. */
export function extractQuick(doc: Document = document): QuickPage {
  const main = doc.querySelector<HTMLElement>('article, main, [role="main"]') ?? doc.body;
  const text = clean(main?.innerText).slice(0, MAX_TEXT);

  const links: PageData['links'] = [];
  for (const a of doc.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    if (links.length >= MAX_LINKS) break;
    if (!/^https?:/.test(a.href)) continue;
    const t = clean(a.innerText || a.getAttribute('aria-label')).slice(0, 200);
    if (t !== '') links.push({ text: t, href: a.href });
  }
  return {
    url: doc.location.href,
    text,
    links,
    pageLabels: labelLikeTexts(doc),
    videoPage: isVideoPage(doc.location),
  };
}

export function extractPage(doc: Document = document): PageData {
  const quick = extractQuick(doc);

  let skippedImages = 0;
  const seen = new Set<string>();
  const win = doc.defaultView ?? window;
  const players = [...doc.querySelectorAll('video')]
    .map((v) => v.getBoundingClientRect())
    .filter((r) => r.width >= MIN_SHOWN && r.height >= MIN_SHOWN);
  const images = [...doc.images]
    .filter((img) => img.naturalWidth >= MIN_SIDE && img.naturalHeight >= MIN_SIDE)
    .map((img) => ({ img, box: img.getBoundingClientRect() }))
    .filter(({ box }) => box.width >= MIN_SHOWN && box.height >= MIN_SHOWN)
    .map((e) => ({ ...e, shown: onScreen(e.box, win) }))
    // What the person is looking at comes first (feeds are long); then the largest files.
    .sort(
      (a, b) =>
        Number(b.shown) - Number(a.shown) ||
        b.img.naturalWidth * b.img.naturalHeight - a.img.naturalWidth * a.img.naturalHeight,
    )
    .filter(({ img }) => {
      const url = img.currentSrc || img.src;
      if (seen.has(url)) return false;
      seen.add(url);
      // Vector drawings (SVG) are icons and diagrams, not pictures a camera or a generator made.
      if (/^data:image\/svg|\.svg(?:[?#]|$)/i.test(url)) return false;
      const ok = /^(https?:|data:image\/)/.test(url);
      if (!ok) skippedImages++;
      return ok;
    })
    .map(({ img, box }) => ({
      url: img.currentSrc || img.src,
      labels: shortTexts(boxOf(img)).slice(0, 12),
      // The still a player shows before or behind its video.
      ...(players.some((p) => covered(box, p) >= 0.8) ? { stillOfVideo: true } : {}),
    }));

  // A streamed video has a blob: address that cannot be fetched as a file; it is still passed
  // on, because labels shown next to it count and its frames can be read while it plays.
  const videos = listVideos(doc).map((v) => ({ ...v, frameId: 0 }));

  return {
    ...quick,
    title: clean(doc.title).slice(0, 200),
    images,
    videos,
    pageWords: wordsAboutAi(doc),
    skippedImages,
  };
}
