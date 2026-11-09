import { MAX_LABEL_LENGTH, matchPlatformLabels } from '@isitreal/core/platform-labels';

/** Collects candidate images and short label strings, then reports them to the background worker. */

const MIN_SIDE = 128;
const sentImages = new Set<string>();
const sentLabels = new Set<string>();
let reportedPage = false;

function shortStrings(root: Document): string[] {
  const out: string[] = [];
  const walker = root.createTreeWalker(root.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
    const t = n.textContent?.trim() ?? '';
    if (t.length > 0 && t.length <= MAX_LABEL_LENGTH) out.push(t);
  }
  for (const el of root.querySelectorAll('[aria-label]')) {
    const t = el.getAttribute('aria-label')?.trim() ?? '';
    if (t.length > 0 && t.length <= MAX_LABEL_LENGTH) out.push(t);
  }
  return out;
}

function scan() {
  if (!document.body) return;
  const images: string[] = [];
  for (const img of document.images) {
    const src = img.currentSrc || img.src;
    if (!src || sentImages.has(src)) continue;
    if (img.naturalWidth < MIN_SIDE || img.naturalHeight < MIN_SIDE) continue;
    sentImages.add(src);
    images.push(src);
  }
  const labels = matchPlatformLabels(location.hostname, shortStrings(document)).filter((h) => {
    const k = `${h.platform}|${h.text}`;
    if (sentLabels.has(k)) return false;
    sentLabels.add(k);
    return true;
  });
  const firstReport = !reportedPage;
  reportedPage = true;
  if (!firstReport && images.length === 0 && labels.length === 0) return;
  void chrome.runtime.sendMessage({
    type: 'census:page',
    host: location.hostname,
    url: location.href,
    newPage: firstReport,
    videos: firstReport ? document.querySelectorAll('video').length : 0,
    images,
    labels,
  });
}

// Feeds load lazily: rescan a few times after load.
scan();
let runs = 0;
const timer = setInterval(() => {
  scan();
  if (++runs >= 6) clearInterval(timer);
}, 5000);
