# M3 results: statistical image detection

**Date:** 2026-11-11 · Shipped detector `image.classifier.commfor-lq@0.1.0` · Reproduce: `python3 -I eval/reference/image_data.py`, `python3 -I eval/reference/image_eval.py`, then `pnpm eval` (the score table `eval/features/image-scores.v1.jsonl` is committed, so the last step alone reproduces every number).

Provenance results (Content Credentials, labels) are in [m3-progress.md](m3-progress.md). This page is about images that carry no label at all.

## Test set

| Set                             | Images                                                        | Notes                                                                            |
| ------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Real photos                     | 800 from Open Images V7 validation: 421 calibration, 379 test | Not in any candidate's training data                                             |
| GPT selfies and portraits       | 200                                                           | `winrisef/gpt-generated-image-collection` (MIT), made September to November 2026 |
| OpenAI gpt-image-2.5            | 200                                                           | `Isaacwang/blip3o-60k-gpt-image-2.5`, October 2026                               |
| Z-Image-Turbo (free open model) | 200                                                           | `jiachengcui888/zimage-turbo-reference` (Apache-2.0), October 2026               |

Every AI image was made after the candidates were trained (August 2026 or earlier). Each image is scored three ways: as published, as a **social copy** (long side 1080 px, JPEG quality 80) and as a **copy of a copy** (512 px, quality 60).

**Calibration rule.** An image is judged once, without knowing its condition, so each real calibration photo contributes its _highest_ score across the three versions. A picture is called _Likely made with AI_ only above the level where at most about 1 in 100 such real photos would be.

## Candidates compared (held-out test split)

| Model                                            | AUROC (orig / social / copy²) | Real photos wrongly flagged | GPT people (orig / social / copy²) | gpt-image-2.5      | Z-Image-Turbo     |
| ------------------------------------------------ | ----------------------------- | --------------------------- | ---------------------------------- | ------------------ | ----------------- |
| Community Forensics ViT (2024-25)                | 0.87 / 0.77 / 0.69            | 1 / 1 / 1 of 379            | 5 / 0 / 0 of 200                   | 1 / 1 / 0          | 47 / 3 / 4        |
| Thermostatic frontier (Aug 2026)                 | 0.97 / 0.96 / 0.93            | 5 / 2 / 1 of 379            | 116 / 54 / 9                       | 104 / 104 / 70     | 131 / 100 / 74    |
| **Thermostatic low-quality (Aug 2026), shipped** | **0.97 / 0.96 / 0.92**        | **2 / 1 / 1 of 379**        | **149 / 59 / 10**                  | **105 / 109 / 71** | **124 / 94 / 68** |

Shipped: the low-quality model, which has the fewest false alarms and the best catch rate on the GPT portraits.

## What it means

- **On images as published, it catches half to three quarters** of these new generators' output (GPT portraits 75%, gpt-image-2.5 53%, Z-Image-Turbo 62%) while wrongly flagging 2 of 379 real photos.
- **Re-sharing hurts a lot for photo-realistic portraits:** GPT portraits drop to 30% as a social copy and 5% as a copy of a copy. The other two sources hold up better (about 50% as social copies, about 35% after two copies).
- **The first-generation Community Forensics model is close to useless on 2026 generators** at this strict setting (5 of 200 GPT portraits). The recent fine-tune is what makes this work.
- **It catches what provenance cannot.** On the owner's real downloads it scores the Perchance image (no label at all) and 3 of 5 chat-upload copies above the threshold; see the local test and the table below.

## On the owner's real downloads

Scores from the shipped model (float32 copy) against the calibrated cut-off (raw score 5.73 in the evaluation; recomputed with the shipped file below). These files are private and not committed.

| File                          | Provenance result | Picture model              | Combined                |
| ----------------------------- | ----------------- | -------------------------- | ----------------------- |
| ChatGPT original              | Made with AI      | above cut-off (12.3)       | Made with AI            |
| Gemini original 1 (edit)      | Made with AI      | above (9.2)                | Made with AI            |
| Gemini original 2 (generated) | Made with AI      | below (-5.4)               | Made with AI            |
| Copilot original              | Made with AI      | below (0.2)                | Made with AI            |
| Meta AI original              | Made with AI      | above (12.0)               | Made with AI            |
| Lovable original              | Made with AI      | just above (6.0)           | Made with AI            |
| **Perchance original**        | No clear signs    | **above (11.9)**           | **Likely made with AI** |
| Gemini chat copies 2, 4, 5    | No clear signs    | **above (9.9, 12.1, 6.5)** | **Likely made with AI** |
| Gemini chat copies 1, 3       | No clear signs    | below (-7.5, 2.6)          | No clear signs          |

The two checks complement each other: provenance catches the signed originals the model misses (Gemini 2, Copilot), and the model catches the unlabelled Perchance image and most re-shared copies. Copy 1 is an edit of a real TV still, so a low score there is reasonable.

## Limits

- **Calibrated on Open Images photos** (mostly 2000s-2010s Flickr photos, about 1024 px). Modern phone photos (HDR, portrait mode, beauty filters), screenshots, memes, drawings and digital art are **not calibrated**; false alarms on them may be higher. Those are common on social media, so this is the most important next measurement.
- 379 real test photos can only show the false-alarm rate is low, not exactly how low (0 to 2% is consistent with these counts).
- AI sets: one GPT style collection, one gpt-image-2.5 set and one open model. Midjourney, Flux, Gemini and Grok output are not in this test.
- The model weights are not ours: MIT-licensed, fine-tuned by an independent author from the Community Forensics model, downloaded on first use from the author's pinned revision and verified by checksum.

## Engineering checks

- The TypeScript preprocessing matches Pillow byte for byte on real photos; the full TypeScript path (sharp decoding, our preprocessing, ONNX Runtime in Node) matches the Python evaluation path with a median score difference of 0 (largest 0.09, from JPEG decoders).
- Evaluation scored a float32 copy of the published float16 file (6x faster on CPU; scores differ by at most 0.07). The shipped calibration was recomputed with the exact published float16 file.
