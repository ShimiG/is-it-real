# M2 results: language-model text detector

**Date:** 2026-11-10 · Engine `0.2.0-m2`, `text.ensemble@0.2.0`, language model `gpt2-124m-onnx-zoo-10` · Reproduce with `pnpm eval` (reads the committed feature table; no model or downloads needed).

## What was built

- **Tier 1 text detector.** A small local language model (GPT-2, 124M parameters) is used as a probability meter: we read the probability it gives each next word and compute the Fast-DetectGPT criterion plus ten surprisal statistics. A logistic model combines those 11 numbers with the 18 Tier 0 statistics. Nothing is prompted (ADR-0001, ADR-0009).
- **Parity check.** The TypeScript criterion matches an independent NumPy port of the reference implementation to within 7.2e-6 on 20 texts (`eval/reference`).
- **Feature table.** 6,578 texts scored once and saved as numbers (`eval/features/text-features.v1.jsonl`), so every number below is reproducible in seconds and in CI.
- **Speed.** About 0.7 seconds per text on a 4-core cloud CPU (first 320 tokens).

## Data

| Source                     | What                                                                                                             | Role                                                  |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Ghostbuster (CC BY 3.0)    | Student essays, Reuters news, Reddit stories: 1,800 human, 900 ChatGPT, 900 Claude, written for the same prompts | Split by prompt: train 40%, calibration 35%, test 25% |
| Ghostbuster "other"        | Non-native English writing (ETS essays, PELIC and Lang-8 learners) and BAWE student writing: 1,279 human texts   | Same split                                            |
| Ghostbuster "undetectable" | 100 AI texts rewritten by a humanizer tool                                                                       | Test only                                             |
| Liang et al. 2023 (MIT)    | 91 TOEFL essays (non-native), 88 US 8th-grade essays, 70 college essays                                          | Test only: the bias benchmark                         |
| Fast-DetectGPT data (MIT)  | 450 human passages with GPT-3.5 and GPT-4 continuations                                                          | Test only: a different source                         |

Calibration uses 1,082 human texts, so the 1% setting is now meaningful (M1 had 101).

## Headline (held-out test split, strict 1% false-alarm setting)

| Detector                                        | Separation (AUROC) | AI caught | Human texts wrongly flagged |
| ----------------------------------------------- | ------------------ | --------- | --------------------------- |
| Tier 0 statistics only (M1 approach, retrained) | 0.905              | 33.8%     | 7 of 1,219                  |
| Fast-DetectGPT criterion alone, nothing trained | 0.912              | 41.9%     | 8 of 1,219                  |
| All language-model features                     | 0.940              | 55.2%     | 8 of 1,219                  |
| **Combined detector (ships)**                   | **0.983**          | **68.1%** | **1 of 1,219**              |

"AI caught" is on Ghostbuster essays, news and stories (420 ChatGPT and Claude texts). One wrongly flagged text in 1,219 is consistent with a true rate of up to about 0.4%.

## Bias table: human writing wrongly flagged by the combined detector

| Group                                   | Texts | Too short to assess | Assessed | Wrongly flagged |
| --------------------------------------- | ----- | ------------------- | -------- | --------------- |
| Non-native: TOEFL essays (Liang et al.) | 91    | 62                  | 29       | 0               |
| Non-native: ETS essays                  | 110   | 0                   | 110      | 0               |
| Non-native: PELIC learners              | 71    | 0                   | 71       | 0               |
| Non-native: Lang-8 learners             | 57    | 1                   | 56       | 0               |
| US 8th-grade essays                     | 88    | 0                   | 88       | 0               |
| College essays                          | 70    | 0                   | 70       | 0               |
| BAWE student writing                    | 74    | 0                   | 74       | 0               |
| Essays / news / stories                 | 429   | 7                   | 422      | 1               |
| Fast-DetectGPT human passages           | 450   | 151                 | 299      | 0               |

**0 of 266 non-native texts were flagged.** For comparison, Liang et al. report that seven commercial detectors flagged 61% of those TOEFL essays on average. Two things did this: non-native writing is part of the calibration set, and the 110-word minimum refuses 62 of the 91 short TOEFL essays instead of guessing.

A lesson from the partial run: with calibration on essays only, 10 of 88 8th-grade essays were flagged. Calibration data must cover the people being judged.

## Where it is weak

| AI source                                            | Caught                |
| ---------------------------------------------------- | --------------------- |
| ChatGPT essays / news / stories                      | 98.5% / 97.3% / 76.8% |
| Claude essays / news / stories                       | 55.6% / 56.8% / 21.5% |
| GPT-3.5 continuations (other source): news / stories | 81.3% / 60.4%         |
| GPT-4 continuations (other source): news / stories   | 30.0% / 4.7%          |
| AI text rewritten by a humanizer tool                | 40 of 100             |

- **Newer and better models are much harder.** It catches almost all 2023 ChatGPT essays, about half of Claude's, and very little GPT-4 story text. All AI text here is from 2023-era models; current models are not measured and will likely be harder still.
- **Rewriting defeats it more often than not** (40% caught), as the research report predicted.
- **Stories are the hardest kind of text.**

## Does the 1% guarantee hold on text it was not calibrated on? No.

Trained and calibrated without one kind of text, then tested on it:

| Held out | AUROC | AI caught | Human wrongly flagged |
| -------- | ----- | --------- | --------------------- |
| Essays   | 0.979 | 87.3%     | **2.2%**              |
| News     | 0.977 | 87.0%     | **4.2%**              |
| Stories  | 0.948 | 17.8%     | 0.2%                  |

The ranking carries over, but the false-alarm rate does not: on unseen kinds of text it was 2 to 4 times the target. The guarantee only covers text that resembles the calibration set. This is why the plan has an "uncalibrated kind of content, so Not assessed" gate; it is not built yet, and until it is, the product should say _Likely AI_ only for kinds of text we calibrated on (essay-like, news-like, story-like, learner writing).

## Addendum: text from a current model (2026-11-10)

All AI text above is from 2023-era models, so I added a test set from a current one: 100 texts (34 essays, 33 news articles, 33 stories) written by helper agents of the Claude Code session that built this project (configured model `claude-fable-5-2`), on the same prompts as 100 human texts in the test split. Details and quirks: `eval/datasets/current-2026/README.md`. Nothing was retrained.

|                                    | 2023 ChatGPT and Claude | Current model (2026)                                          |
| ---------------------------------- | ----------------------- | ------------------------------------------------------------- |
| Caught at the strict 1% setting    | 68.1%                   | **13 of 100** (essays 8 of 34, news 5 of 33, stories 0 of 33) |
| Separation from human text (AUROC) | 0.983                   | 0.731                                                         |
| Caught at a looser 5% setting      | not measured            | 46 of 100                                                     |

Why: to GPT-2, the current model's writing looks almost like human writing.

| Median value                               | Human | ChatGPT 2023 | Claude 2023 | Current model |
| ------------------------------------------ | ----- | ------------ | ----------- | ------------- |
| Fast-DetectGPT criterion                   | 0.70  | 4.04         | 2.22        | 1.41          |
| Share of words that were GPT-2's top guess | 36%   | 46%          | 41%         | 35%           |

What this means:

- **On today's AI text, the text detector will rarely say _Likely AI_.** It stays honest (it says "No clear signs", never "Human"), but it adds little for modern text.
- This matches the theory in the research report: as models get closer to human writing, statistical detection approaches chance. It strengthens the plan's priorities: provenance labels and scam rules first, statistical text detection as a supporting signal.
- Limits of this check: 100 texts, one model family, three kinds of writing, lightly trimmed texts.
- Options to improve it: retrain with current-model text in the training set (needs several hundred more such texts, and risks fitting one model family), and score with a stronger model than GPT-2.

## Not done in M2

- **RAID benchmark** (the plan's target): its files are not reachable from the build environment. Ghostbuster and the Fast-DetectGPT set stand in.
- **Binoculars** (needs a second model). The DivEye-style surprisal statistics are included.
- **PyTorch parity.** The check covers the scoring math against a NumPy port, not the ONNX export against PyTorch weights.
- **Real scam messages** (carried from M1; the owner is collecting some).

## Follow-ups

1. More current-model text (other vendors, paraphrased text), and retraining with it (see the addendum).
2. The kind-of-text gate, so unfamiliar content returns _Not assessed_.
3. A smaller or quantized model for the browser (665 MB is too large); each candidate needs its own feature table and calibration.
4. More calibration data from more kinds of everyday text (emails, social posts, product reviews).
