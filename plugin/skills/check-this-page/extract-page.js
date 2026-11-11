// Collects what the is-it-real `check_page` tool needs from the current page.
// Run in the page; it returns a JSON string to pass to check_page as-is.
// Read-only: it changes nothing on the page and sends nothing anywhere.
(() => {
  const MAX_TEXT = 20000;
  const MAX_LINKS = 200;
  const MAX_IMAGES = 12;
  const MIN_SIDE = 128;
  const SHORT = 60;
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

  const main = document.querySelector('article, main, [role="main"]') || document.body;
  const text = clean(main.innerText).slice(0, MAX_TEXT);

  const links = [];
  for (const a of document.querySelectorAll('a[href]')) {
    if (links.length >= MAX_LINKS) break;
    if (!/^https?:/.test(a.href)) continue;
    const t = clean(a.innerText || a.getAttribute('aria-label')).slice(0, 200);
    if (t) links.push({ text: t, href: a.href });
  }

  const shortTexts = (root) => {
    const out = new Set();
    for (const el of [root, ...root.querySelectorAll('*')]) {
      for (const attr of ['alt', 'aria-label', 'title']) {
        const v = clean(el.getAttribute && el.getAttribute(attr));
        if (v && v.length <= SHORT) out.add(v);
      }
      if (el.childElementCount === 0) {
        const v = clean(el.textContent);
        if (v && v.length <= SHORT) out.add(v);
      }
      if (out.size >= 20) break;
    }
    return [...out];
  };

  let skipped = 0;
  const images = [...document.images]
    .filter((img) => img.naturalWidth >= MIN_SIDE && img.naturalHeight >= MIN_SIDE)
    .filter((img) => {
      const r = img.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    })
    .sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight)
    .filter((img) => {
      const url = img.currentSrc || img.src;
      const ok = /^(https?:|data:image\/)/.test(url);
      if (!ok) skipped++;
      return ok;
    })
    .slice(0, MAX_IMAGES)
    .map((img) => {
      const box = img.closest('figure, article, [role="article"], div') || img.parentElement || img;
      return { url: img.currentSrc || img.src, nearby_labels: shortTexts(box).slice(0, 12) };
    });

  const labelWords = /\b(ai|a\.i\.|synthetic|generated|imagined|content credentials|altered)\b/i;
  const pageLabels = shortTexts(document.body).filter((s) => labelWords.test(s));
  for (const el of document.querySelectorAll('[aria-label]')) {
    const v = clean(el.getAttribute('aria-label'));
    if (v.length <= SHORT && labelWords.test(v) && !pageLabels.includes(v)) pageLabels.push(v);
  }

  return JSON.stringify({
    page_url: location.href,
    text,
    links,
    images,
    page_labels: pageLabels.slice(0, 50),
    note:
      skipped > 0 ? `${skipped} images could not be passed (for example blob: images).` : undefined,
  });
})();
