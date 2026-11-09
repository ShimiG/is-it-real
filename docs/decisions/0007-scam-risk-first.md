# 0007: Scam risk is shown before AI signals

**Status:** accepted (2026-11-09)

## Context

For an older user the harm is the scam, not the AI. "This page asks for gift cards" is actionable and reliable; "this text is likely AI" is neither by itself (plenty of legitimate text is AI-assisted).

## Decision

`PageReport` carries `scamRisk` and its reasons first; per-item AI verdicts follow. Scam detection is a first-class, pure-algorithm rule engine (urgency, unusual payment, secrecy, impersonation, link mismatch, lookalike domains, too-good-to-be-true) with plain-language advice ("Don't pay; call someone you trust").

## Consequences

- Scam rules get their own eval set and recall/false-alarm targets (M1).
- AI signals still matter, for example as supporting evidence for deepfake celebrity investment ads.
