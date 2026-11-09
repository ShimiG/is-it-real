# 0001: Algorithms decide, LLMs only explain

**Status:** accepted (2026-11-09)

## Context

The project must be explainable, reproducible and cheap to run on-device. Asking a chat model "is this AI?" gives an unmeasurable, prompt-sensitive answer, and the model's own writing style overlaps with what it is judging.

## Decision

Every score comes from deterministic code: provenance checks, statistics, signal processing, and small local models used as _probability meters_ (token log-probabilities, image-classifier logits), never prompted for opinions. Claude, when present (Phase 1), orchestrates tools and rewrites reason codes in friendlier words; it never sets or changes an outcome. User-facing explanations come from templates (`packages/core/src/reasons/en.ts`), so the product works with no LLM at all.

## Consequences

- Results are reproducible and can be evaluated (`pnpm eval`).
- The standalone extension needs no API key or account.
- We accept lower raw accuracy than commercial ensemble detectors in exchange for transparency.
