# M1 results: scam rules and Tier 0 text statistics

**Date:** 2026-11-10 · Engine `0.1.0-m1`, `scam-rules@0.1.0`, `text.stats@0.1.0` · Reproduce with `pnpm eval:fetch` then `pnpm eval`.

## Scam rules

Pure pattern rules, no model (ADR-0001, ADR-0007). "Flagged" means medium or high risk.

| Set         | What it is                                                                                           | Scams flagged    | Benign flagged     |
| ----------- | ---------------------------------------------------------------------------------------------------- | ---------------- | ------------------ |
| `scam-dev`  | 25 scam + 25 benign messages, used for tuning                                                        | 25 of 25         | 0 of 25            |
| `scam-test` | 40 scam + 40 benign messages, **frozen in git before any rule existed** (commit `208f7e6`), run once | **40 of 40**     | **1 of 40 (2.5%)** |
| SMS ham     | 4,827 real, normal text messages (SMS Spam Collection)                                               | n/a              | **0 of 4,827**     |
| SMS spam    | 747 real spam texts from the 2000s (informational)                                                   | 17 of 747 (2.3%) | n/a                |

M1 target (recall ≥ 90% at < 5% false alarms): **met on the frozen test set.**

What these numbers do and don't show:

- **The scam sets were written by the same author as the rules** (an AI assistant, modelled on public consumer-protection guidance). Freezing the test set first stops tuning against it, but its wording still resembles what the rules expect. Treat 100% as an upper bound. Independent, real scam messages are the main gap; collecting them is the first M2 follow-up.
- **The one false alarm** is a scam-awareness article listing romance-scam tactics. Sentences that say "scammers ask for…" are skipped, but this one described the tactic in a follow-up sentence. Awareness pages are where false alarms will come from.
- **The 2.3% on old SMS spam is expected, not a failure.** That set is mostly premium-rate ringtone and prize-line advertising, not the elder-targeted fraud the rules look for. It is listed so nobody assumes the rules are a general spam filter.
- Three rule changes came from the real SMS messages: arrest threats must be aimed at the reader, brand look-alikes allow one edit only (a real bank, ICICI, was one edit pair away from "Citi"), and texting shorthand ("u", "ur") is expanded.

## Tier 0 text statistics

18 simple features (sentence-length variation, vocabulary variety, punctuation, AI-typical phrases and so on) combined by a small logistic model. Data: Fast-DetectGPT's GPT-3.5/GPT-4 set (news and story passages; human originals vs. model continuations). Split by passage into train 40% / calibration 35% / test 25%; numbers below are on the held-out test split.

| Metric                                                          | Value                                            |
| --------------------------------------------------------------- | ------------------------------------------------ |
| Separation (AUROC)                                              | 0.983                                            |
| AI detected at the 1% false-alarm setting (the product default) | **9.3%** (14 of 150)                             |
| AI detected at a 5% false-alarm setting                         | 78.7%                                            |
| Human passages flagged                                          | 0 of 75 at both settings                         |
| Not assessed                                                    | 31% (all the medical Q&A items: under 110 words) |
| Trained on stories, tested on news (AUROC)                      | 0.991                                            |
| Trained on news, tested on stories (AUROC)                      | 0.813                                            |

How to read this:

- **At the strict setting we ship, Tier 0 alone catches about 1 in 10.** That is by design: with 101 human calibration passages, a text is only called _Likely AI_ when it scores above every one of them. More calibration data (M2) will raise this without loosening the guarantee.
- **0.983 is flattering.** The test passages come from the same two sources and the same two 2023 models as the training data, and the AI texts are continuations of a human opening. The cross-domain rows are the honest figure: it can drop to about 0.81 on a kind of text it wasn't trained on, and it will be lower again on new models, paraphrased text and non-native writers (not yet measured; the bias set is an M2 item).
- 75 human test passages cannot confirm a 1% false-alarm rate (0 of 75 is consistent with anything up to about 4%).
- Tier 0 therefore stays a low-weight signal, as planned. Its jobs are the "Not assessed" gates (too short, not English) and supporting Tier 1 (M2).

## What a user sees today

`checkText()` returns scam risk first, then the text verdict. For the IRS gift-card message in the unit tests it returns high scam risk with four plain-language reasons, and _Not checked_ for AI because the message is too short to judge.
