# Context handoff: AI content detection plugin

> Paste this whole file into a new chat (or attach it) to carry over the context of the planning conversation held 2026-11-07 to 2026-11-09.
> Full plan: `docs/DEVELOPMENT_PLAN.md` (in this repo).

## Who / what

- **User:** a senior software engineer and system designer (works at CommBox).
- **Idea:** a tool that scans web pages and flags AI-generated content. It starts as a **Claude plugin for Claude in Chrome**. The long-term aim is a **standalone browser extension / app, possibly mobile**.
- **Source material:** a Gemini Deep Research report on AI content forensics. It covers perplexity, Binoculars, Fast-DetectGPT, DivEye, RAID/MGTBench, image frequency artifacts, PRNU, LipForensics, audio (LPC, bispectrum, AASIST), watermarks (Kirchenbauer, SynthID, Tree-Ring, Stable Signature), C2PA, paraphrase attacks, calibration/conformal prediction, non-native-writer bias, and Daubert.
- **The user's stated wishes:**
  1. Ideally it **runs in the background and alerts** whenever AI content is detected.
  2. It may be **open source**.
  3. It's intended as a **portfolio project**.

## Status

- `docs/DEVELOPMENT_PLAN.md` written (v0.1). No code yet; the repo holds only docs.
- No decisions have been finalized by the user yet.

## Core design (from the plan)

1. **One detection core, thin clients on top.** A versioned Python service exposes REST plus an MCP endpoint. Shared TS packages: `@aid/schema` (the Finding contract), `@aid/extract` (DOM extraction and anchors), `@aid/local` (WASM C2PA, IPTC/XMP, platform-label adapters). Clients: the Claude plugin, an MV3 extension (built with WXT), a Safari extension, a mobile share-target app.
2. **Provenance first, statistics second.** C2PA manifests, IPTC `digitalSourceType`, and the AI labels platforms already show in the DOM come first. After that: Binoculars or Fast-DetectGPT plus DivEye-style surprisal features, combined by a calibrated stacker. Images: provenance + an off-the-shelf model or API, then an own classifier trained with web-degradation augmentations.
3. **Never say "Human".** Outcome levels: Verified AI / Likely AI / Inconclusive / Not assessed. A conformal threshold at α (1%) decides whether to flag; an isotonic/Platt confidence is displayed. Content that is too short (<~150 tokens), in an unsupported language, or in an uncalibrated bucket returns "Not assessed".
4. **DOM extraction, not screenshots.** Screenshots destroy metadata, C2PA and frequency signals, and OCR corrupts token statistics. Screenshot mode is only a fallback, labeled low confidence.
5. **Claude orchestrates and explains but never judges.** An LLM-as-judge is not a detector. Scores come from tools.

## Decisions listed in the plan (D0–D14) with current recommendations

| # | Decision | Recommendation |
|---|---|---|
| D0 | Audience | Professionals (journalists, fact-checkers, T&S) first; avoid education positioning |
| D1 | First host | Core first → Claude plugin as dogfood client → MV3 extension. Verify whether Claude in Chrome supports remote MCP connectors. |
| D2 | Input | DOM first, screenshot fallback |
| D3 | Compute | Hybrid: provenance and labels local, heavy models in the cloud on demand |
| D4 | Text method | Ensemble: Binoculars or Fast-DetectGPT + surprisal features + calibrated stacker; commercial API only as a baseline; LLM-as-judge never scores |
| D5 | Image method | Provenance always + an off-the-shelf model or API in v1 → own classifier later; PRNU dropped |
| D6 | Provenance scope | C2PA + IPTC/XMP + platform DOM labels; vendor watermark detectors when available |
| D7 | Modalities | Text + images in v1; video and audio deferred |
| D8 | Scan trigger | Local checks automatic, cloud on demand + right-click |
| D9 | UX | Outcome levels + an evidence panel; no "Human" verdict |
| D10 | Calibration | Conformal for the flag decision + isotonic for the displayed confidence |
| D11 | Languages | English v1 with a language-ID gate; Hebrew as a possible second language |
| D12 | Stack | TS monorepo (pnpm/turborepo, WXT), Python FastAPI core, MCP on the same service, serverless GPU, Expo for mobile |
| D13 | Mobile | Safari Web Extension + share-target app first; Android screen overlay only if demanded (impossible on iOS) |
| D14 | Privacy | Hash-only cache, opt-in sample donation, domain deny-list, runtime permissions |

**Waiting on the user:** D0 (audience) and D11 (languages). These two drive most of the other decisions.

## Where the report is too optimistic (agreed reading)

- Text watermarks (SynthID-Text, Kirchenbauer) can't be checked by third parties because the keys are private to the vendor.
- PRNU absence at 0.95 accuracy is a lab result and unreliable on resized or recompressed web images.
- Frequency artifacts weaken with resizing, re-encoding and newer generators. Use them as classifier features only.
- C2PA has high precision but low recall, because most platforms strip it.

## Competitor landscape (searched 2026-11-07)

- **Text:** Pangram (often rated most accurate), GPTZero "Origin", Originality.ai, Copyleaks, Winston AI.
- **Multi-modal page scanners:** Hive AI Detector (free; image, video, audio, text; seems lightly maintained), AI Identifiers, UncovAI, BitMind (~70–80% on images in one review), IsItAI, deepeye, Resemble AI Deepfake Detector.
- **C2PA-only:** Digimarc Content Credentials extension (open source, C2PA-JS), "Content Credentials Verif".
- **From memory, to be verified:** Google's SynthID Detector portal; McAfee's on-device deepfake audio detection; TrueMedia.org (shut down early 2025 and open-sourced its models).
- **Pattern:** almost all of them are right-click → vendor cloud → percentage. None found that is provenance-first, uses calibrated outcome levels that never say "Human", scans passively on the device, is open source, or exposes an MCP endpoint.

## Opinions given

**Open source: yes, there's a need.**
- Every existing detector is a black box; an auditable one is valuable.
- It fits the local-first privacy story.
- It suits a uBlock-style model with community-maintained platform-label adapters and calibration data.
- Evasion concerns are minor, because statistical detectors are already beaten by paraphrasers.

**Background alerting is the riskiest part:**
- **Alert fatigue:** for example, ~500 assessable items a day at 1% FPR is about 5 false alerts a day.
- AI-assisted text blurs the line between human and AI.
- Cloud scanning in the background is unaffordable for open source and breaks privacy.
- Running models on every page costs battery and memory.

**Suggested background-mode design:**
- **Local only, unobtrusive badges.** Interrupt only for Verified AI (provenance or platform label) or very high statistical confidence (α ≈ 0.1%). Everything else is a quiet badge or a daily digest.
- **Bring your own key (BYOK)** for heavy checks: the user supplies their own Pangram or Hive API key, or self-hosts the core.
- **Treat the engine as infrastructure:** an open library plus an MCP endpoint.

**Differentiation:**
- Real for trust and transparency.
- Weak for typical consumers on raw accuracy; don't try to out-train Pangram or Hive.
- Hard as a business. Open core is possible.

**Key experiment before building background mode:** measure how often provenance or platform AI labels actually appear during normal browsing.
- If often, background alerts can rest on near-certain evidence.
- If rarely, almost every alert would be a statistical guess, so the design has to change.

**Portfolio: strong fit, if scoped down and finished.**

| Portfolio MVP (6–10 weeks part-time) | Skip for now |
|---|---|
| MV3 extension with background provenance and label badges | Mobile, Safari, desktop |
| One text detector in a small Python service | Own image classifier |
| Calibrated outcome levels with abstention | Multiple languages |
| MCP endpoint + Claude plugin | Video and audio |
| BYOK slot for one image API | Accounts and billing |
| Public evaluation report (detection and false-positive rates by subgroup, failure cases) | Drift pipeline (write it up only) |

- **Repo deliverables:** README with an architecture diagram, 5–8 ADRs, the evaluation report, a 2-minute demo video, an (unlisted) Web Store listing, and one write-up post (e.g. "Why my AI detector never says *Human*").
- **Cautions:**
  - Check the employment agreement, since the project may be adjacent to CommBox's domain.
  - Keep the cautious wording to avoid reputational harm from false flags.

## Open follow-ups (offered, not yet accepted)

1. Add a competitor section to the plan and revisit build-vs-buy.
2. Fold into the plan: the background-mode design, open-source license, BYOK, and the provenance-frequency experiment in Phase 0.
3. Rewrite the plan around the **portfolio MVP** scope.
