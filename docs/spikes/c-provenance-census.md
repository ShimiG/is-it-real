# Spike (c): provenance census

**Date:** 2026-11-09 · **Status:** first data in (2026-11-11); **provisional decision**, more data welcome · **Feeds:** background-mode alert rules (M6)

## Question

How often do _near-certain_ AI markers actually show up in normal browsing?

- If often: background alerts can rest on Verified AI evidence.
- If rarely: almost every alert would be a statistical guess, so background mode should show quiet badges only, and interrupt only for scam risk.

## The tool

`spikes/provenance-census` is a small developer extension. On every page it:

- counts pages and `<video>` elements;
- fetches images at least 128 × 128 px and sniffs them for C2PA manifests, IPTC "made by AI" source types and generator settings (`@isitreal/core/provenance/sniff`);
- matches short on-page strings against platform AI labels (`@isitreal/core/platform-labels`);
- skips sites on a never-scan list (banks, email, health; editable in the popup).

Data stays in the browser's extension storage. The popup shows totals and can export JSON. It keeps up to 25 example URLs per hit type so hits can be checked by hand; it stores no page content.

Smoke test (2026-11-09, headless Chromium, local test page): an image with Stable Diffusion
settings was flagged, a plain image was not, a short "AI-generated" badge was counted and a long
sentence mentioning AI was ignored.

## How to run it

```bash
pnpm install
```

```bash
pnpm --filter @isitreal/spike-provenance-census build
```

Then open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and pick
`spikes/provenance-census/dist`. Browse normally for 3–5 days (include social media: Facebook,
Instagram, YouTube, TikTok, news sites). Then click **Export JSON** in the popup and save the file
as `docs/spikes/data/census-<date>.json` (remove any example URLs you'd rather not commit).

## Decision rule (fixed before looking at the data)

| Result                                                                                | Background-mode design                                                                     |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Verified markers (C2PA AI claim, IPTC AI code, platform label) on **≥ 1 in 50 pages** | Alerts for Verified AI are worth it, as planned                                            |
| **< 1 in 50 pages**                                                                   | Quiet badges only; interrupting alerts only for high scam risk. AI checks mainly on demand |

Also record: the share of images that are unreadable (blob/streamed), which tells M3/M6 how often we'll say "couldn't check".

## Known limits

- The sniffers check that markers are _present_; they don't validate signatures (that's M3).
- Platform label patterns are guesses until hits are checked by hand; wrong patterns get fixed in `packages/core/src/platform-labels.ts`.

## Results, round 1 (2026-11-09 to 2026-11-11)

Three days of the owner's normal browsing. Only totals are recorded here: the export also lists the sites visited, which is private and is not committed.

|                               | Count                                           |
| ----------------------------- | ----------------------------------------------- |
| Pages counted                 | 179 (another 10 skipped by the never-scan list) |
| Different sites               | 34                                              |
| Images checked                | 442                                             |
| Images that could not be read | 22 (4.7%: streamed or `blob:` images)           |
| Videos seen                   | 11                                              |
| Content Credentials           | **0**                                           |
| IPTC "made by AI" label       | **0**                                           |
| Image-generator settings      | **0**                                           |
| Platform AI labels            | **0**                                           |

**What it means.** Zero hits in 179 pages means the true rate is very likely below about 1 in 60 pages (95% upper bound, "rule of three"), and below about 0.7% of images. That is under the "1 in 50 pages" bar set before collecting data.

**Provisional decision:** background mode shows **quiet badges only** and interrupts only for **high scam risk**. AI checks run mainly on demand ("Check this page").

**Caveats, so this is provisional:**

- The browsing was mostly work and job search: only 12 of the 179 pages were on social or video sites (LinkedIn, YouTube, Reddit), and none on Facebook, Instagram or TikTok, where platform AI labels and AI images are most common. The platform-label patterns were therefore barely exercised.
- One person, three days. Older adults' browsing (Facebook, WhatsApp web, news) may look quite different.
- The real-file tests in M3 show why the rate is low: most images on the web have been re-encoded by the site and have lost their labels.

**Next round:** more days, ideally including social media, or a second person's browsing. The decision is revisited before M6 (the extension).
