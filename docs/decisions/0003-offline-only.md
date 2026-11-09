# 0003: Offline only; no bring-your-own-key cloud APIs

**Status:** accepted (2026-11-09) · supersedes the first planning chat's BYOK suggestion

## Context

The audience includes older adults, who should not need accounts or API keys, and page content can be private. Cloud detection per page is also unaffordable for a free project.

## Decision

All analysis runs on the user's device. The only network use is (1) a one-time download of open model files, and (2) fetching the page's own images and videos from the site already being viewed. No telemetry, no domain-age or reverse-image lookups, no cloud detector APIs (including bring-your-own-key) for now. Caches store hashes, never content. Sensitive sites (banking, email, health) are never scanned by default.

## Consequences

- Some strong signals (domain age, reverse image search, commercial detectors) are unavailable; they may return later as clearly labelled opt-ins.
- Model size and speed on a mid-range laptop become hard constraints.
