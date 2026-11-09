# 0002: Four outcome levels; never say "Human"

**Status:** accepted (2026-11-09)

## Context

Detection is bounded by theory (the closer a generator gets to human text, the closer any detector gets to chance) and is easily evaded by paraphrasing. Text detectors also over-flag non-native writers. A "Human" or "Real" verdict would be a promise we can't keep, and a false "AI" verdict can hurt a real person.

## Decision

Exactly four outcomes, encoded in `packages/core/src/types.ts` with no `human` value:

| Outcome            | When                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------- |
| **Verified AI**    | A valid provenance claim (C2PA, IPTC) or the platform's own AI label declares it             |
| **Likely AI**      | Statistical evidence at or above the conformal threshold (ADR-0006)                          |
| **No clear signs** | Assessed, but below the threshold. Wording: "That does not prove a person made it"           |
| **Not assessed**   | Too short, unsupported language, unreadable, or no calibration data for this kind of content |

Tests enforce that no user-facing string claims content is human, real or safe, and that there are no bare percentages.

## Consequences

- More items end up "No clear signs" or "Not assessed"; the eval report publishes these shares.
- The write-up angle: "Why my AI detector never says _Human_".
