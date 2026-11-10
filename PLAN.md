# Is It Real? Work Plan (v0.3, draft for approval)

> Status: **APPROVED 2026-11-09.** M0 done except the census data collection (spike c), which needs a few days of the owner's normal browsing. **M1 done 2026-11-10** ([results](docs/eval/m1-results.md)). **M2 done 2026-11-10** ([results](docs/eval/m2-results.md)); RAID and Binoculars deferred, see the results page. **M3 in progress** ([notes](docs/eval/m3-progress.md)): image provenance (C2PA with the official trust list, metadata, platform labels), the page-level check and the frequency-feature groundwork are in; statistical image detection is blocked on data that the build environment cannot download. Spike results: [`docs/spikes`](docs/spikes/README.md); decisions: [`docs/decisions`](docs/decisions/README.md).
> Owner decisions recorded 2026-11-08/09 (see §12): private repo, Apache-2.0, English only, Claude plugin first, offline only, video in the MVP.
> v0.2 folds in the portfolio advice from the original (lost) planning chat: finish-first scope, a "Not assessed" outcome, never saying "Human", platform AI-label badges, background provenance checks, decision records and the portfolio deliverables in §13.
> v0.3 merges the first planning chat's handoff ([`docs/history/2026-11-07-first-planning-chat.md`](docs/history/2026-11-07-first-planning-chat.md)): its outcome levels (Verified AI / Likely AI), DOM-not-screenshots, the alert-fatigue rules for background mode, the provenance-frequency experiment, privacy details and the competitor landscape.
> Created 2026-11-08. Source research: [`docs/research/ai-content-forensics-report.md`](docs/research/ai-content-forensics-report.md) (Gemini Deep Research), plus the extra research noted in §11.

---

## 1. Goal

A **free, open-source, on-device** tool that looks at what's on the current browser page (text, images, video) and tells a non-technical person, in plain words, whether it may be AI-generated and whether the page looks like a scam.

Three things it has to do at once:

1. **Portfolio piece.** Clean architecture, real evaluation numbers, a public write-up.
2. **Free open-source alternative** to paid detectors (Hive, AI or Not, GPTZero and others).
3. **Protect older adults from AI-driven scams**: deepfake celebrity investment videos, AI-generated romance-scam profiles, fake bank and government messages.

Delivery path: **Claude plugin first, then a standalone browser extension, then possibly a mobile app.** All three share one detection core.

## 2. Guiding principles

| #   | Principle                              | What it means in practice                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | **Algorithms first, LLMs last**        | Every verdict comes from deterministic math (statistics, signal processing, cryptographic checks). A small local language model may be used as a **probability meter** (token log-probabilities, never prompted or asked for opinions). A chat LLM such as Claude is used only to orchestrate and to explain results in plain language, never to decide them.                                                                                                                                                          |
| P2  | **"I can't tell" is a valid answer**   | The research shows detectors are bounded by theory and easy to evade (report §§1, 6). The UI must never show false certainty. Four outcomes: **Verified AI** (cryptographic provenance or the platform's own AI label), **Likely AI** (statistical evidence above the conformal threshold), **No clear signs** (inconclusive: nothing found, or mixed evidence) and **Not assessed** (too short, not English, unreadable or unsupported). **The tool never says "Human" or "Real"**: absence of evidence is not proof. |
| P3  | **Scam risk over AI-ness**             | For an older user, "this page asks you to pay with gift cards" matters more than "this text is 72% AI". Scam heuristics are a first-class detector, not an add-on.                                                                                                                                                                                                                                                                                                                                                     |
| P4  | **Offline and private**                | Everything runs locally. Nothing is uploaded, there's no telemetry, and there are no online lookups. The only network use: a one-time download of the open model files at install, and reading the page's own images/videos from the site the browser already loaded them from.                                                                                                                                                                                                                                        |
| P5  | **Fairness is measured, not assumed**  | Text detectors are known to wrongly flag non-native writers (Liang et al. 2023: 61% false positives on TOEFL essays). We test for this and publish the numbers, and never use text-only "AI" verdicts to accuse anyone.                                                                                                                                                                                                                                                                                                |
| P6  | **Accessible by design**               | Large type, high contrast, plain language, read-aloud, a "what should I do?" action, WCAG 2.2 AA.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| P7  | **Finish first**                       | A small project that ships beats a big one half-built. Milestones are ordered so a usable, demo-able version exists at the end of M4 (about week 7); everything after that is additive.                                                                                                                                                                                                                                                                                                                                |
| P8  | **Read the page, not a picture of it** | Text and media come from the DOM and the original files. Screenshots destroy metadata, C2PA and frequency signals, and OCR corrupts token statistics. Screenshot capture is only a fallback and is labelled low confidence.                                                                                                                                                                                                                                                                                            |

## 3. Reality check: what is and isn't detectable (from the report plus my review)

| Signal                                                                                                                    | Feasible in browser?                                                                                                           | Reliability                                                                                                                                                                                      | Plan                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| **C2PA Content Credentials** (cryptographic)                                                                              | Yes, via `@contentauth/c2pa-web` (WASM)                                                                                        | **Very high when present**, but most images don't carry it                                                                                                                                       | MVP. Strongest positive signal.                                                                                                |
| **Platform AI labels** (e.g. Meta "AI info", YouTube "Altered or synthetic content", TikTok "AI-generated")               | Yes, read from the page's DOM, offline                                                                                         | High when present; only covers content the uploader or platform declared                                                                                                                         | MVP. Shown as "The site itself labels this as AI-made". Selectors kept in one versioned file because sites change their markup |
| **IPTC/XMP `DigitalSourceType = trainedAlgorithmicMedia`**, generator metadata (SD "parameters" PNG chunk, software tags) | Yes, pure parsing                                                                                                              | High when present; easily stripped                                                                                                                                                               | MVP                                                                                                                            |
| **Text statistics** (burstiness, lexical diversity, repetition)                                                           | Yes, pure JS                                                                                                                   | Weak alone; domain- and population-biased                                                                                                                                                        | MVP, low weight                                                                                                                |
| **Zero-shot LM scoring** (Fast-DetectGPT, Binoculars, DivEye surprisal moments)                                           | Yes, with a small ONNX LM (about 135M–500M parameters) on WebGPU/WASM                                                          | Moderate. Paper numbers use 7B models; small models will score lower. **Must be measured by us.**                                                                                                | MVP (Fast-DetectGPT first)                                                                                                     |
| **Image frequency analysis** (FFT/DCT spectral peaks, DWT diagonal band)                                                  | Yes, pure math (WASM/JS)                                                                                                       | Moderate; weakened by resizing and recompression, which web images always go through                                                                                                             | MVP, medium weight                                                                                                             |
| **Small image classifier** (ONNX ViT/MobileViT, e.g. CommunityForensics)                                                  | Yes, ONNX Runtime Web                                                                                                          | Good in-distribution, unknown on new generators                                                                                                                                                  | MVP, must be evaluated                                                                                                         |
| **PRNU sensor-noise absence**                                                                                             | Technically yes                                                                                                                | **Low on web images.** Resizing and JPEG recompression destroy PRNU, so "no PRNU" is also true for most real photos online. The report's "> 0.95 accuracy" applies to original-resolution files. | Research spike only                                                                                                            |
| **Text watermarks** (Kirchenbauer, SynthID-Text)                                                                          | Detection needs the vendor's secret keys                                                                                       | N/A for third parties                                                                                                                                                                            | Out of scope; document why                                                                                                     |
| **Image watermarks** (SynthID-Image, Tree-Ring, Stable Signature)                                                         | Need vendor keys or models                                                                                                     | N/A                                                                                                                                                                                              | Out of scope; link to vendor checkers where they exist                                                                         |
| **Video**: per-frame image checks, temporal flicker FFT, C2PA on video files                                              | Partly. Cross-origin and DRM video frames can't be read by page scripts; an extension can use `tabCapture`/`captureVisibleTab` | Low to moderate                                                                                                                                                                                  | **MVP** (owner decision), labelled experimental                                                                                |
| **Lip-sync / LipForensics**, **audio deepfakes** (LPC glottal, bispectrum, AASIST)                                        | Heavy models; audio needs capture permission                                                                                   | Moderate in lab settings                                                                                                                                                                         | Later phase (mobile is where voice-clone calls happen)                                                                         |

**Bottom line:** the most dependable, explainable wins are (1) provenance metadata, (2) scam-pattern detection, and (3) a calibrated combination of weak statistical signals with an honest "can't tell" zone.

## 4. Architecture

```
                 +-------------------------------------------+
                 |  @isitreal/core  (TypeScript + WASM/ONNX)  |
                 |                                           |
                 |  detectors/                               |
                 |    text/   stats, fastDetectGPT, diveye   |
                 |    scam/   urgency, payment, impersonation,|
                 |            link-mismatch, lookalike domain|
                 |    image/  c2pa, metadata, fft, classifier|
                 |    video/  frame-sampler -> image + temporal|
                 |  fusion/   calibrated combiner (logistic + |
                 |            conformal thresholds) -> Verdict|
                 |  explain/  plain-language reasons (templates,|
                 |            i18n, no LLM)                   |
                 +-------------------+-----------------------+
                                     | same package, 3 hosts
          +--------------------------+--------------------------+
          v                          v                          v
 Phase 1: Claude plugin     Phase 2: MV3 extension      Phase 3: mobile
 MCP server (Node) +        content script collects     share-sheet / screenshot
 skill "check this page";   page items -> offscreen     analysis, later call audio
 Claude in Chrome reads     doc runs core (WebGPU) ->
 the page, tools return     accessible side panel
 verdicts, Claude explains
```

**Key contracts (defined in M0):**

```ts
type Signal = {
  detector: string;
  modality: 'text' | 'image' | 'video' | 'page';
  score: number /* 0..1, calibrated */;
  weight: number;
  evidence: string[]; /* machine-readable reason codes */
};
type Verdict = {
  label: 'verified_ai' | 'likely_ai' | 'no_clear_signs' | 'not_assessed'; // never 'human'
  scamRisk: 'high' | 'medium' | 'low';
  confidence: number;
  signals: Signal[];
  reasons: LocalizedReason[]; /* template-based */
};
```

- Every detector is a pure function, `input -> Signal`, unit-testable in Node.
- Model weights are **downloaded on demand** (opt-in "deep check") and cached. They are never bundled.
- Heavy inference runs in an **offscreen document / Web Worker** (WebGPU isn't available in MV3 service workers), with a WASM fallback.

## 5. Detectors in detail

### 5.1 Text (tiered)

- **Tier 0, pure algorithms (no model):** sentence-length burstiness (coefficient of variation), MATTR lexical diversity, function-word and punctuation profile, n-gram repetition, a list of over-used "LLM-isms" (low weight, easily gamed). Minimum length about 150 words; below that the answer is always "Not assessed".
- **Tier 1, small local LM as a probability meter:** Fast-DetectGPT (Conditional Probability Curvature, one model, single pass) on a quantized small LM (candidates: SmolLM2-135M/360M, Qwen2.5-0.5B, both Apache-2.0). Then Binoculars (observer/performer pair from one model family) and DivEye surprisal variance, skewness, kurtosis and autocorrelation. Thresholds are **re-calibrated by us**; the report's 0.901 Binoculars threshold only holds for the Falcon-7B pair.
- **Tier 2, optional and off by default:** Claude rewrites the reasons in friendlier language. It never changes the score.

### 5.2 Scam patterns (text and page, pure algorithms)

Weighted rule engine with explainable hits:

- urgency and threats ("account suspended", "within 24 hours", "arrest")
- unusual payment methods (gift cards, crypto, wire, "don't tell the bank")
- secrecy and isolation ("don't tell your family")
- impersonation (bank, government, tech-support and delivery brand names on a non-matching domain)
- link text vs. `href` mismatch, lookalike and homoglyph domains (punycode, edit distance to a top-brands list)
- "too good to be true" investment promises, celebrity name plus investment
- _(later, if online lookups are ever allowed: domain age via RDAP)_

Each hit maps to a plain-language reason and advice ("Real banks never ask for gift cards. Don't pay. Call your bank using the number on your card.").

### 5.3 Images

1. Fetch the image bytes from the extension context (host permissions avoid canvas tainting).
2. C2PA manifest, read and validated: shows _who made it_ and whether an AI tool is declared.
3. IPTC/XMP/EXIF/PNG-chunk generator metadata, plus the platform's own AI label next to the image if there is one.
4. Spectral analysis: FFT magnitude spectrum, periodic upsampling peaks, DWT HH-band energy.
5. ONNX classifier (shortlist: CommunityForensics DeepfakeDet ViT, Qwip's MobileViT models and others, chosen by our own eval).
6. _(Later, not in the offline MVP:)_ a "Search for this image" button for reverse image search, useful against stolen and AI romance-scam photos.

Skip tiny images (icons, under 128 px) and limit to the N largest visible images.

### 5.4 Video (in the MVP, labelled experimental)

Pipeline (same core in both hosts):

1. C2PA and container metadata on the video file when the file itself is reachable (MP4/WebM).
2. Sample about 1 frame per second (up to about 30 frames), run the image pipeline per frame and aggregate (median plus the share of flagged frames).
3. Temporal-consistency signal: frame-to-frame flicker spectrum and optical-flow jitter, focused on the face region when a face is found (a small on-device face detector, not an LLM).
4. Lip-sync and audio checks stay in "later".

Getting frames differs by host:

- **Plugin (Phase 1):** the MCP server downloads direct video files (`.mp4`/`.webm` URLs) and extracts frames locally with ffmpeg. For streamed video (YouTube, Facebook, HLS/`blob:` URLs), Claude in Chrome saves a few screenshots to disk and passes the file paths to our tool (lower confidence). The page-to-localhost bridge was dropped after the M0 spike: Chrome 142+ shows a Local Network Access permission prompt for it ([spike a](docs/spikes/a-video-frames.md), ADR-0008). DRM video gets an honest "couldn't check this video".
- **Extension (Phase 2):** `tabCapture` reads whatever is on screen, so streamed and cross-origin video work too (DRM video shows up black and is reported as "couldn't check").

### 5.5 Fusion and calibration

- Per-detector Platt scaling on a calibration set.
- A logistic-regression combiner over the calibrated signals (simple, explainable, no black box).
- **Conformal thresholds** targeting ≤ 1% false positives on human content. Anything below the threshold is "No clear signs".
- Scam risk is computed separately and shown first.
- Hard overrides: a valid C2PA manifest or platform label declaring AI generation gives **Verified AI** regardless of the statistical signals (and the reason says so). Nothing can produce "Human".
- Two calibrations with two jobs: the **conformal threshold** (α = 1%) decides whether to flag _Likely AI_; **isotonic/Platt** calibration produces the confidence shown in the evidence panel.
- **Not assessed gates:** under about 150 tokens, a language-ID check says not English, or the content falls into a bucket we have no calibration data for.

## 6. Evaluation (the portfolio centrepiece)

- `eval/` harness in Node, reproducible with one command, outputs a markdown and JSON report.
- `eval/reference/` (Python): the papers' reference implementations of Fast-DetectGPT/Binoculars, used only to check that our ONNX port gives the same scores. Not shipped.
- **Text:** RAID (incl. paraphrase/adversarial splits), MGTBench subsets, our own small set from current models. **Bias set:** TOEFL essays (Liang et al.) and other non-native and older-writer samples. We report FPR per group.
- **Images:** GenImage / CommunityForensics test splits plus our own fresh SDXL/Flux/current-model images and real photos taken with phones and **re-encoded the way social media does it**.
- **Scam:** public phishing corpora plus hand-made examples of elder-targeted scams.
- Metrics: AUROC, TPR @ 1% FPR, calibration error, latency per item on a mid-range laptop.
- Publish `EVAL.md` with honest numbers: detection rates, false-positive rates **by subgroup**, the share of items that end up _Can't tell_ / _Not assessed_, and a gallery of failure cases.
- A short written plan for drift monitoring (re-running the eval when new generators appear). Written, not built, in the MVP.

## 7. UX and accessibility (for older users)

- One big button: **"Check this page"**. The result is a traffic-light card plus at most 3 plain-language reasons.
- A **"What should I do?"** panel: don't pay, don't click, call a family member, report links.
- Text 18 px or larger, a large-text mode, high contrast, full keyboard use, screen-reader labels, optional read-aloud (Web Speech API).
- English only for the MVP. All user-facing strings live in one message file so other languages (including right-to-left ones) can be added later without code changes.
- Never a bare percentage without words. Always show "why".
- Usability test with 3–5 older users before the store release.

## 8. Tech stack

- **Monorepo:** pnpm workspaces, TypeScript, Vitest, ESLint/Prettier, GitHub Actions CI.
- `packages/core`: detectors, fusion and explain (runs in Node and the browser).
- `packages/mcp-server`: Node MCP server exposing `check_text`, `check_image`, `check_video`, `check_page_bundle` and `scam_check` (video frames via ffmpeg).
- `packages/claude-plugin`: plugin manifest, the `check-this-page` skill and the MCP server config.
- `apps/extension`: WXT (MV3, Chrome first, then Firefox/Edge), side-panel UI, offscreen inference. **Background mode:** as you browse, only the cheap checks run automatically (C2PA, metadata, platform labels, scam rules) and show small badges; the heavy model checks run when you press "Check this page" or right-click an item.
  **Alert rules (avoid alert fatigue):** at about 500 assessable items a day, even a 1% false-positive rate is about 5 false alarms a day. So the extension **interrupts only for Verified AI, a high scam risk, or very high statistical confidence (α ≈ 0.1%)**. Everything else is a quiet badge. These rules are tuned with the M0 experiment below.
- `eval/`: datasets loader, runners, reports.
- **ML runtime:** ONNX Runtime Web / Transformers.js (WebGPU with a WASM fallback); `onnxruntime-node` for the MCP server and eval.
- **Provenance:** `@contentauth/c2pa-web` in the browser and the c2pa Node bindings on the server side.
- **Why TypeScript and not a Python service:** the same core has to run inside the browser extension later, so the runtime is TypeScript + ONNX from day one. Python is used only in `eval/reference/` to verify parity with the papers' code.
- **License:** Apache-2.0 (includes a patent grant). Each model's license is checked and listed in `MODELS.md`.

## 9. Milestones (about 12 weeks part-time; each ends with a demo and a tagged release)

Ordered so that **a complete, demo-able tool exists after M4 (about week 7)**. Video and the extension build on it.

| M                                         | Weeks | Deliverable                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Done when                                                                                                                                                                                          |
| ----------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M0** Foundations                        | 1     | Monorepo, CI, `Signal`/`Verdict` types, eval-harness skeleton, CONTRIBUTING, first decision records (§13). **Three spikes:** (a) video frame bridge; (b) how the plugin is hosted: Claude Code plus Claude in Chrome with a local MCP server, and whether Claude in Chrome on its own accepts custom connectors; (c) **provenance-frequency experiment**: browse normally for a few days and count how often C2PA, IPTC or platform AI labels actually appear | CI green; `pnpm eval` runs on a toy set; spike results written up. If (c) shows labels are rare, background alerts would mostly be statistical guesses, so the alert rules are revisited before M6 |
| **M1** Text Tier 0 + Scam engine          | 1.5   | Pure-algorithm text stats and scam rules, with reason templates                                                                                                                                                                                                                                                                                                                                                                                               | Unit tests; scam eval ≥ 90% recall on our elder-scam set at < 5% FPR on normal pages                                                                                                               |
| **M2** Text Tier 1                        | 1.5   | Fast-DetectGPT on a small ONNX LM (Node and browser), parity-checked against the Python reference; calibration and conformal thresholds; Binoculars/DivEye if time allows. Carried over from M1: a larger human calibration set, independent real scam messages, and the non-native-writer bias set                                                                                                                                                           | Published TPR @ 1% FPR on a RAID subset plus a bias table                                                                                                                                          |
| **M3** Images                             | 2     | C2PA, metadata, platform labels, FFT and ONNX classifier, plus fusion                                                                                                                                                                                                                                                                                                                                                                                         | C2PA test assets verified; classifier eval on fresh generators published                                                                                                                           |
| **M4** Claude plugin (Phase 1) = **v0.1** | 1     | MCP server, the `check-this-page` skill, first `EVAL.md`                                                                                                                                                                                                                                                                                                                                                                                                      | Claude in Chrome reads a page, tools return verdicts for text and images, Claude explains them without changing them. **First shippable version**                                                  |
| **M5** Video                              | 1.5   | Frame sampling (ffmpeg in Node, page bridge or tab capture in browser), per-frame image pipeline, temporal signal, video C2PA; added to the plugin                                                                                                                                                                                                                                                                                                            | Eval on a deepfake video test set (FaceForensics++ subset plus fresh text-to-video clips), labelled experimental. **Gate:** the owner confirms detection is good enough to start Phase 2           |
| **M6** Standalone extension (Phase 2)     | 2     | MV3 extension, background badges, accessible side panel, offscreen WebGPU, one-time model download                                                                                                                                                                                                                                                                                                                                                            | Works offline after the model download; WCAG check; tested with 3–5 older users                                                                                                                    |
| **M7** Launch                             | 1     | Final `EVAL.md`, README with architecture diagram, 2-minute demo video, Web Store listing (unlisted is fine), write-up post                                                                                                                                                                                                                                                                                                                                   | Everything in §13 is done                                                                                                                                                                          |
| **Later**                                 | n/a   | More languages, opt-in online lookups, lip-sync/audio, Firefox, mobile (share-sheet screenshot check), drift-monitoring pipeline                                                                                                                                                                                                                                                                                                                              | Separate plans                                                                                                                                                                                     |

## 10. Risks and mitigations

| Risk                                                                                                        | Mitigation                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Detectors are evadable (paraphrasing, re-encoding)                                                          | "Can't tell" band; lead with scam risk; publish failure cases                                                                                                                                     |
| False accusations (bias against non-native writers)                                                         | Conformal ≤ 1% FPR, a per-group bias table, wording that never says "this person used AI"                                                                                                         |
| Small models score worse than paper numbers                                                                 | Measure first; choose the model by eval; Tier 1 is an optional "deep check"                                                                                                                       |
| Model download size (100–400 MB)                                                                            | One-time download at install, cached, quantized (q4/q8), with a progress UI                                                                                                                       |
| Streamed video unreadable in the plugin phase                                                               | Screenshots-to-disk fallback (spike a); otherwise honest "couldn't check"; full support arrives with the extension's tab capture                                                                  |
| Cross-origin/DRM media unreadable                                                                           | Background fetch with host permissions; tab capture fallback; say "couldn't check" honestly                                                                                                       |
| Claude in Chrome needs a paid plan, which limits elder reach                                                | Phase 1 is a dev and demo vehicle; the free standalone extension is the real accessibility deliverable                                                                                            |
| New generators outdate the classifiers                                                                      | Classifier is one signal among many; a re-train/re-eval script in `eval/`                                                                                                                         |
| Scope creep, so it never ships                                                                              | P7: v0.1 at M4 is complete on its own; anything not in a milestone goes to "Later"                                                                                                                |
| A public detector wrongly flags real people, hurting them and the project's reputation                      | Never says "Human" or accuses anyone; cautious wording; publish false-positive rates                                                                                                              |
| Privacy of scanned pages                                                                                    | Cache stores hashes only, never content; a domain deny-list (banking, health and email by default, user-editable) is never scanned; optional permissions are requested at runtime, not at install |
| **Employment agreement** may claim side projects near the employer's field (AI and customer communications) | Owner checks the contract before the repo goes public; built on personal time and equipment and kept in personal accounts                                                                         |

## 11. Extra research notes (beyond the Gemini report)

- **C2PA in the browser:** the official JS SDK moved to `@contentauth/c2pa-web` (the old `c2pa` package was deprecated around Oct 2025). It runs in Web Workers. Ed25519 signatures may not be supported; verify at M3. https://opensource.contentauthenticity.org/docs/c2pa-js/packages/c2pa-web/
- **WebGPU in MV3 extensions** isn't available in the service worker; use an offscreen document. https://medium.com/@GenerationAI/transformers-js-onnx-runtime-webgpu-in-chrome-extension-13b563933ca9
- **Existing open-source in-browser image detectors** to benchmark against or reuse: Qwip (ONNX, WebGPU) https://chromeboard.com/extension/qwip-ai-detection-beta-jihgkhibgodlejmgfgonjjmilebggnca, CommunityForensics ViT ONNX https://huggingface.co/onnx-community/CommunityForensics-DeepfakeDet-ViT-ONNX, LAID benchmark of lightweight detectors https://arxiv.org/abs/2507.05162, DejAIvu https://arxiv.org/abs/2502.08821
- **Competitor landscape** (searched 2026-11-07, from the first planning chat):
  - Text: Pangram (often rated most accurate), GPTZero "Origin", Originality.ai, Copyleaks, Winston AI.
  - Multi-modal page scanners: Hive AI Detector (free; seems lightly maintained), AI Identifiers, UncovAI, BitMind (about 70–80% on images in one review), IsItAI, deepeye, Resemble AI Deepfake Detector.
  - C2PA only: Digimarc Content Credentials extension (open source), "Content Credentials Verif".
  - To verify: Google's SynthID Detector portal, McAfee on-device deepfake audio detection, TrueMedia.org (shut down early 2025, models open-sourced; possible reusable assets).
  - Pattern: almost all are right-click, then the vendor's cloud, then a percentage.
- **Differentiator:** none of them is provenance-first, on-device, open source, scam-focused for older users, uses calibrated outcome levels that never say "Human", and exposes an MCP endpoint. We don't try to beat Pangram or Hive on raw accuracy; the edge is trust, transparency and the audience.

## 12. Owner decisions (2026-11-08)

| #   | Question                                                      | Decision                                                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Repo name and visibility                                      | `is-it-real`, **private for now**                                                                                                                                                                                                                      |
| 2   | License                                                       | **Apache-2.0** (portfolio-friendly, with a patent grant)                                                                                                                                                                                               |
| 3   | Languages                                                     | **English only for now**; other languages later (strings kept in one file to make that easy)                                                                                                                                                           |
| 4   | Phase 1 vehicle                                               | **Claude plugin first.** Move to the standalone extension once the detection model works well (gate at the end of M4)                                                                                                                                  |
| 5   | Network lookups                                               | **Offline only.** No domain-age or reverse-image lookups for now                                                                                                                                                                                       |
| 6   | Video                                                         | **In the first version** (milestone M5, labelled experimental)                                                                                                                                                                                         |
| 7   | Bring-your-own-key cloud image API (from the original chat)   | **Not included**: it conflicts with offline-only. Can come back later as an opt-in                                                                                                                                                                     |
| 0   | Audience                                                      | **Older adults and the general public**, scam protection first. (The first planning chat suggested journalists and fact-checkers; the owner's later goals moved it.) Professionals remain a secondary audience via the evidence panel and MCP endpoint |
| 8   | Python service for the text detector (from the original chat) | **No**: TypeScript + ONNX core so the extension can reuse it; Python only to check results in `eval/`                                                                                                                                                  |

## 13. Portfolio deliverables (what a reviewer sees in five minutes)

- README with an architecture diagram and a GIF.
- `docs/decisions/`: 6–8 short decision records (ADRs):
  1. Algorithms decide, LLMs only explain
  2. Four outcome levels (Verified AI / Likely AI / No clear signs / Not assessed), and why it never says "Human"
  3. Offline only (and no bring-your-own-key cloud APIs)
  4. TypeScript/ONNX shared core; Python only for evaluation parity
  5. Claude plugin first, extension after the M5 gate
  6. Conformal thresholds at ≤ 1% false positives on human content
  7. Scam risk is shown before AI signals
  8. Video capture strategy per host, and DOM-first reading (screenshots only as a fallback)
- `EVAL.md`: detection rates, false-positive rates by subgroup, failure cases.
- A 2-minute demo video.
- A Chrome Web Store listing (unlisted is fine).
- One write-up post (working title: "Why my AI detector never says _Human_").
