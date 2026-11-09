# Is It Real? Work Plan (v0.1, draft for approval)

> Status: **PROPOSED, NOT APPROVED.** Nothing gets built until the owner approves this plan.
> Owner decisions recorded 2026-11-08 (see §12): private repo, English only, Claude plugin first, offline only, video in the MVP. License still open.
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

| # | Principle | What it means in practice |
|---|-----------|---------------------------|
| P1 | **Algorithms first, LLMs last** | Every verdict comes from deterministic math (statistics, signal processing, cryptographic checks). A small local language model may be used as a **probability meter** (token log-probabilities, never prompted or asked for opinions). A chat LLM such as Claude is used only to orchestrate and to explain results in plain language, never to decide them. |
| P2 | **"I can't tell" is a valid answer** | The research shows detectors are bounded by theory and easy to evade (report §§1, 6). The UI must never show false certainty. Three verdicts: *Signs of AI*, *No signs found*, *Can't tell*. |
| P3 | **Scam risk over AI-ness** | For an older user, "this page asks you to pay with gift cards" matters more than "this text is 72% AI". Scam heuristics are a first-class detector, not an add-on. |
| P4 | **Offline and private** | Everything runs locally. Nothing is uploaded, there's no telemetry, and there are no online lookups. The only network use: a one-time download of the open model files at install, and reading the page's own images/videos from the site the browser already loaded them from. |
| P5 | **Fairness is measured, not assumed** | Text detectors are known to wrongly flag non-native writers (Liang et al. 2023: 61% false positives on TOEFL essays). We test for this and publish the numbers, and never use text-only "AI" verdicts to accuse anyone. |
| P6 | **Accessible by design** | Large type, high contrast, plain language, read-aloud, a "what should I do?" action, WCAG 2.2 AA. |

## 3. Reality check: what is and isn't detectable (from the report plus my review)

| Signal | Feasible in browser? | Reliability | Plan |
|---|---|---|---|
| **C2PA Content Credentials** (cryptographic) | Yes, via `@contentauth/c2pa-web` (WASM) | **Very high when present**, but most images don't carry it | MVP. Strongest positive signal. |
| **IPTC/XMP `DigitalSourceType = trainedAlgorithmicMedia`**, generator metadata (SD "parameters" PNG chunk, software tags) | Yes, pure parsing | High when present; easily stripped | MVP |
| **Text statistics** (burstiness, lexical diversity, repetition) | Yes, pure JS | Weak alone; domain- and population-biased | MVP, low weight |
| **Zero-shot LM scoring** (Fast-DetectGPT, Binoculars, DivEye surprisal moments) | Yes, with a small ONNX LM (about 135M–500M parameters) on WebGPU/WASM | Moderate. Paper numbers use 7B models; small models will score lower. **Must be measured by us.** | MVP (Fast-DetectGPT first) |
| **Image frequency analysis** (FFT/DCT spectral peaks, DWT diagonal band) | Yes, pure math (WASM/JS) | Moderate; weakened by resizing and recompression, which web images always go through | MVP, medium weight |
| **Small image classifier** (ONNX ViT/MobileViT, e.g. CommunityForensics) | Yes, ONNX Runtime Web | Good in-distribution, unknown on new generators | MVP, must be evaluated |
| **PRNU sensor-noise absence** | Technically yes | **Low on web images.** Resizing and JPEG recompression destroy PRNU, so "no PRNU" is also true for most real photos online. The report's "> 0.95 accuracy" applies to original-resolution files. | Research spike only |
| **Text watermarks** (Kirchenbauer, SynthID-Text) | Detection needs the vendor's secret keys | N/A for third parties | Out of scope; document why |
| **Image watermarks** (SynthID-Image, Tree-Ring, Stable Signature) | Need vendor keys or models | N/A | Out of scope; link to vendor checkers where they exist |
| **Video**: per-frame image checks, temporal flicker FFT, C2PA on video files | Partly. Cross-origin and DRM video frames can't be read by page scripts; an extension can use `tabCapture`/`captureVisibleTab` | Low to moderate | **MVP** (owner decision), labelled experimental |
| **Lip-sync / LipForensics**, **audio deepfakes** (LPC glottal, bispectrum, AASIST) | Heavy models; audio needs capture permission | Moderate in lab settings | Later phase (mobile is where voice-clone calls happen) |

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
type Signal = { detector: string; modality: 'text'|'image'|'video'|'page';
                score: number /* 0..1, calibrated */; weight: number;
                evidence: string[] /* machine-readable reason codes */ };
type Verdict = { label: 'signs_of_ai'|'no_signs'|'cant_tell';
                 scamRisk: 'high'|'medium'|'low';
                 confidence: number; signals: Signal[];
                 reasons: LocalizedReason[] /* template-based */ };
```

- Every detector is a pure function, `input -> Signal`, unit-testable in Node.
- Model weights are **downloaded on demand** (opt-in "deep check") and cached. They are never bundled.
- Heavy inference runs in an **offscreen document / Web Worker** (WebGPU isn't available in MV3 service workers), with a WASM fallback.

## 5. Detectors in detail

### 5.1 Text (tiered)

- **Tier 0, pure algorithms (no model):** sentence-length burstiness (coefficient of variation), MATTR lexical diversity, function-word and punctuation profile, n-gram repetition, a list of over-used "LLM-isms" (low weight, easily gamed). Minimum length about 150 words; below that the answer is always "can't tell".
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
- *(later, if online lookups are ever allowed: domain age via RDAP)*

Each hit maps to a plain-language reason and advice ("Real banks never ask for gift cards. Don't pay. Call your bank using the number on your card.").

### 5.3 Images

1. Fetch the image bytes from the extension context (host permissions avoid canvas tainting).
2. C2PA manifest, read and validated: shows *who made it* and whether an AI tool is declared.
3. IPTC/XMP/EXIF/PNG-chunk generator metadata.
4. Spectral analysis: FFT magnitude spectrum, periodic upsampling peaks, DWT HH-band energy.
5. ONNX classifier (shortlist: CommunityForensics DeepfakeDet ViT, Qwip's MobileViT models and others, chosen by our own eval).
6. *(Later, not in the offline MVP:)* a "Search for this image" button for reverse image search, useful against stolen and AI romance-scam photos.

Skip tiny images (icons, under 128 px) and limit to the N largest visible images.

### 5.4 Video (in the MVP, labelled experimental)

Pipeline (same core in both hosts):
1. C2PA and container metadata on the video file when the file itself is reachable (MP4/WebM).
2. Sample about 1 frame per second (up to about 30 frames), run the image pipeline per frame and aggregate (median plus the share of flagged frames).
3. Temporal-consistency signal: frame-to-frame flicker spectrum and optical-flow jitter, focused on the face region when a face is found (a small on-device face detector, not an LLM).
4. Lip-sync and audio checks stay in "later".

Getting frames differs by host:
- **Plugin (Phase 1):** the MCP server downloads direct video files (`.mp4`/`.webm` URLs) and extracts frames locally with ffmpeg. Streamed video (YouTube, Facebook, HLS/`blob:` URLs) is the hard case, because Claude in Chrome's screenshots go to Claude, not to our tools. **M0 spike:** test a local bridge where a small page script sends canvas frames to the MCP server on `127.0.0.1`. If that's blocked (cross-origin "tainted" video, DRM), the plugin says "couldn't check this video" honestly.
- **Extension (Phase 2):** `tabCapture` reads whatever is on screen, so streamed and cross-origin video work too (DRM video shows up black and is reported as "couldn't check").

### 5.5 Fusion and calibration

- Per-detector Platt scaling on a calibration set.
- A logistic-regression combiner over the calibrated signals (simple, explainable, no black box).
- **Conformal thresholds** targeting ≤ 1% false positives on human content. The band between thresholds becomes "can't tell".
- Scam risk is computed separately and shown first.

## 6. Evaluation (the portfolio centrepiece)

- `eval/` harness in Node, reproducible with one command, outputs a markdown and JSON report.
- **Text:** RAID (incl. paraphrase/adversarial splits), MGTBench subsets, our own small set from current models. **Bias set:** TOEFL essays (Liang et al.) and other non-native and older-writer samples. We report FPR per group.
- **Images:** GenImage / CommunityForensics test splits plus our own fresh SDXL/Flux/current-model images and real photos taken with phones and **re-encoded the way social media does it**.
- **Scam:** public phishing corpora plus hand-made examples of elder-targeted scams.
- Metrics: AUROC, TPR @ 1% FPR, calibration error, latency per item on a mid-range laptop.
- Publish `EVAL.md` with honest numbers, including where it fails.

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
- `apps/extension`: WXT (MV3, Chrome first, then Firefox/Edge), side-panel UI, offscreen inference.
- `eval/`: datasets loader, runners, reports.
- **ML runtime:** ONNX Runtime Web / Transformers.js (WebGPU with a WASM fallback); `onnxruntime-node` for the MCP server and eval.
- **Provenance:** `@contentauth/c2pa-web` in the browser and the c2pa Node bindings on the server side.
- **License:** recommended Apache-2.0 (includes a patent grant). Each model's license is checked and listed in `MODELS.md`.

## 9. Milestones (about 12 weeks part-time with video in the MVP; each ends with a demo and a tagged release)

| M | Weeks | Deliverable | Done when |
|---|---|---|---|
| **M0** Foundations | 1 | Monorepo, CI, `Signal`/`Verdict` types, eval-harness skeleton, license, CONTRIBUTING | CI green; `pnpm eval` runs on a toy set |
| **M1** Text Tier 0 + Scam engine | 1.5 | Pure-algorithm text stats and scam rules, with reason templates | Unit tests; scam eval ≥ 90% recall on our elder-scam set at < 5% FPR on normal pages |
| **M2** Text Tier 1 | 1.5 | Fast-DetectGPT on a small ONNX LM (Node and browser), then Binoculars/DivEye; calibration and conformal thresholds | Published TPR @ 1% FPR on RAID subset plus a bias table |
| **M3** Images | 2 | C2PA, metadata, FFT and ONNX classifier, plus fusion | C2PA test assets verified; classifier eval on fresh generators published |
| **M3b** Video | 1.5 | Frame sampling (ffmpeg in Node, canvas/tab capture in browser), per-frame image pipeline, temporal signal, video C2PA | Eval on a deepfake video test set (e.g. FaceForensics++ subset plus fresh text-to-video clips) published, labelled experimental |
| **M4** Claude plugin (Phase 1) | 1 | MCP server, the `check-this-page` skill and a demo video | Claude in Chrome reads a page, tools return verdicts for text, images and direct video files, Claude explains them without changing them. **Gate:** the owner confirms the model works well enough before Phase 2 starts |
| **M5** Standalone extension (Phase 2) | 2 | MV3 extension, accessible side panel, offscreen WebGPU, on-demand model download | Works offline after the model download; WCAG check; tested with 3–5 older users |
| **M6** Launch | 1 | `EVAL.md`, README with GIFs, Chrome Web Store listing, blog/portfolio write-up | Public repo and store listing |
| **Later** | n/a | More languages, online lookups (opt-in), lip-sync/audio, Firefox, mobile (share-sheet screenshot check), audio/voice-clone research | Separate plans |

## 10. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Detectors are evadable (paraphrasing, re-encoding) | "Can't tell" band; lead with scam risk; publish failure cases |
| False accusations (bias against non-native writers) | Conformal ≤ 1% FPR, a per-group bias table, wording that never says "this person used AI" |
| Small models score worse than paper numbers | Measure first; choose the model by eval; Tier 1 is an optional "deep check" |
| Model download size (100–400 MB) | One-time download at install, cached, quantized (q4/q8), with a progress UI |
| Streamed video unreadable in the plugin phase | M0 spike on a localhost frame bridge; otherwise honest "couldn't check"; full support arrives with the extension's tab capture |
| Cross-origin/DRM media unreadable | Background fetch with host permissions; tab capture fallback; say "couldn't check" honestly |
| Claude in Chrome needs a paid plan, which limits elder reach | Phase 1 is a dev and demo vehicle; the free standalone extension is the real accessibility deliverable |
| New generators outdate the classifiers | Classifier is one signal among many; a re-train/re-eval script in `eval/` |

## 11. Extra research notes (beyond the Gemini report)

- **C2PA in the browser:** the official JS SDK moved to `@contentauth/c2pa-web` (the old `c2pa` package was deprecated around Oct 2025). It runs in Web Workers. Ed25519 signatures may not be supported; verify at M3. https://opensource.contentauthenticity.org/docs/c2pa-js/packages/c2pa-web/
- **WebGPU in MV3 extensions** isn't available in the service worker; use an offscreen document. https://medium.com/@GenerationAI/transformers-js-onnx-runtime-webgpu-in-chrome-extension-13b563933ca9
- **Existing open-source in-browser image detectors** to benchmark against or reuse: Qwip (ONNX, WebGPU) https://chromeboard.com/extension/qwip-ai-detection-beta-jihgkhibgodlejmgfgonjjmilebggnca, CommunityForensics ViT ONNX https://huggingface.co/onnx-community/CommunityForensics-DeepfakeDet-ViT-ONNX, LAID benchmark of lightweight detectors https://arxiv.org/abs/2507.05162, DejAIvu https://arxiv.org/abs/2502.08821
- **Differentiator vs. existing tools:** multi-modal, provenance-first, scam-focused, calibrated "can't tell", designed for older users, with a public eval.

## 12. Owner decisions (2026-11-08)

| # | Question | Decision |
|---|---|---|
| 1 | Repo name and visibility | `is-it-real`, **private for now** |
| 2 | License | **Open.** Apache-2.0, MIT or GPL-3.0 (see the comparison in the chat; to be decided before the repo goes public) |
| 3 | Languages | **English only for now**; other languages later (strings kept in one file to make that easy) |
| 4 | Phase 1 vehicle | **Claude plugin first.** Move to the standalone extension once the detection model works well (gate at the end of M4) |
| 5 | Network lookups | **Offline only.** No domain-age or reverse-image lookups for now |
| 6 | Video | **In the first version** (new milestone M3b, labelled experimental) |
