# Spike (c): provenance census

**Date:** 2026-11-09 · **Status:** tool built and smoke-tested; **data collection pending (owner)** · **Feeds:** background-mode alert rules (M6)

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
