# M3 results: statistical image detection

**Date:** 2026-11-11 (photo gate added the same day) · Shipped detector `image.classifier.commfor-lq@0.1.0` behind `image.photo-gate@0.1.0` · Reproduce: `python3 -I eval/reference/image_data.py`, `python3 -I eval/reference/image_eval.py`, then `pnpm eval` (the score tables `eval/features/image-scores.v1.jsonl` and `image-gate.v1.jsonl` are committed, so the last step alone reproduces every number).

Provenance results (Content Credentials, labels) are in [m3-progress.md](m3-progress.md). This page is about images that carry no label at all.

> **Read this first.** The sections from "Test set" to "On the owner's real downloads" describe the picture model **on its own**, calibrated on stock-style photos only. Measuring it on everyday images showed it cannot be used that way (next section), so what ships is the picture model **behind a photo gate**. The shipped numbers are in "What ships: the picture model behind the photo gate".

## False alarms by kind of image (picture model on its own)

1,400 more non-AI images were added, 200 of each kind, half for calibration and half for testing: phone photos (SPAQ, 66 phone models), screenshots (ScreenSpot-v2), memes (Hateful Memes, 2020), and human-made cartoons, digital art, sketches and cosplay / stage photos (Human-Art, collected 2022). Result with the photo-only calibration, images as published:

| Kind of image (not AI)   | Wrongly flagged     |
| ------------------------ | ------------------- |
| Stock-style photos       | 2 of 379 (0.5%)     |
| Phone photos             | 2 of 90 (2%)        |
| Cosplay and stage photos | 2 of 93 (2%)        |
| Screenshots              | 3 of 100 (3%)       |
| Sketches                 | 3 of 94 (3%)        |
| Memes                    | 8 of 108 (7%)       |
| **Cartoons**             | **34 of 112 (30%)** |
| **Digital art**          | **30 of 89 (34%)**  |

In total 84 of 1,065. The model calls about a third of human-made cartoons and digital paintings "AI": it reacts to the drawn or painted look, not to who made the picture. Calibrating on every kind of image at once fixes the art (about 4%) but the cut-off rises so far that detection falls to 22% / 18% / 35%. Neither is acceptable.

## What ships: the picture model behind the photo gate

**The gate.** Before the picture model is asked, a second measurement decides whether the image is a _plain photo_. A general-purpose image encoder (CLIP ViT-B/32, MIT, 89 MB, downloaded once and checked by sha256) turns the image into 512 numbers; a small logistic model trained here reads them. Trained on the calibration half only: plain photos (stock, phone, stage) against everything else (cartoons, digital art, sketches, screenshots, memes). Images that do not pass get **"not checked"** with the reason _"This looks like a drawing, a screenshot or a picture with added text. Our picture check only works on plain photos."_ Simple pixel statistics were tried first and failed (80% of digital art passed).

Memes were first counted as photos. The picture model then wrongly flagged 7 of 108, so pictures with added text are kept out as well.

Share of held-out images the gate lets through (all three versions):

| Plain photos             | Passes | Everything else | Passes |
| ------------------------ | ------ | --------------- | ------ |
| Stock-style photos       | 96%    | Cartoons        | 0%     |
| Phone photos             | 100%   | Digital art     | 0%     |
| Cosplay and stage photos | 89%    | Sketches        | 0%     |
| AI: GPT portraits        | 87%    | Screenshots     | 4%     |
| AI: gpt-image-2.5        | 63%    | Memes           | 8%     |
| AI: Z-Image-Turbo        | 75%    |                 |        |

The gate threshold is 0.5, the natural middle of the trained model; it was not tuned on the test half.

**Calibration.** The picture model is now calibrated on the images it is allowed to judge: all 645 non-AI calibration images that pass the gate (420 stock photos, 110 phone photos, 107 stage photos and 8 others that slipped through), each at its highest score across the three versions. Cut-off: raw score 6.27 (was 5.73).

**Shipped result, held-out test half:**

| Not AI: wrongly flagged  | As published          | Social copy | Copy of a copy | Not checked |
| ------------------------ | --------------------- | ----------- | -------------- | ----------- |
| Stock-style photos       | 2 of 379 (0.5%)       | 0           | 1              | 4%          |
| Phone photos             | 1 of 90               | 0           | 0              | 0%          |
| Cosplay and stage photos | 1 of 93               | 0           | 0              | 10%         |
| Memes                    | 2 of 108              | 0           | 1              | 92%         |
| Screenshots              | 0 of 100              | 0           | 0              | 97%         |
| Cartoons                 | 0 of 112              | 0           | 0              | 100%        |
| Digital art              | 0 of 89               | 0           | 0              | 100%        |
| Sketches                 | 0 of 94               | 0           | 0              | 100%        |
| **All non-AI images**    | **6 of 1,065 (0.6%)** | **0**       | **2**          |             |

| AI: caught                      | As published | Social copy | Copy of a copy | Not checked |
| ------------------------------- | ------------ | ----------- | -------------- | ----------- |
| GPT selfies and portraits       | 61.5%        | 18.5%       | 3.5%           | 10%         |
| OpenAI gpt-image-2.5            | 22%          | 22.5%       | 10.5%          | 37%         |
| Z-Image-Turbo (free open model) | 39%          | 27.5%       | 16.5%          | 26%         |

**What the gate cost, honestly.** False alarms fell from 84 to 6 of 1,065. Detection fell too: 75% / 53% / 62% of originals became 61.5% / 22% / 39%. Most of that loss is AI pictures that are drawings or carry text: the model "caught" them before, but it said the same of a third of human-made drawings, so those catches told the user nothing. They are now "not checked". The rest is the higher cut-off that phone and stage photos require.

## Test set

| Set                             | Images                                                        | Notes                                                                            |
| ------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Real photos                     | 800 from Open Images V7 validation: 421 calibration, 379 test | Not in any candidate's training data                                             |
| GPT selfies and portraits       | 200                                                           | `winrisef/gpt-generated-image-collection` (MIT), made September to November 2026 |
| OpenAI gpt-image-2.5            | 200                                                           | `Isaacwang/blip3o-60k-gpt-image-2.5`, October 2026                               |
| Z-Image-Turbo (free open model) | 200                                                           | `jiachengcui888/zimage-turbo-reference` (Apache-2.0), October 2026               |

Every AI image was made after the candidates were trained (August 2026 or earlier). Each image is scored three ways: as published, as a **social copy** (long side 1080 px, JPEG quality 80) and as a **copy of a copy** (512 px, quality 60).

**Calibration rule.** An image is judged once, without knowing its condition, so each real calibration photo contributes its _highest_ score across the three versions. A picture is called _Likely made with AI_ only above the level where at most about 1 in 100 such real photos would be.

## Candidates compared (held-out test split, picture model on its own)

| Model                                            | AUROC (orig / social / copy²) | Real photos wrongly flagged | GPT people (orig / social / copy²) | gpt-image-2.5      | Z-Image-Turbo     |
| ------------------------------------------------ | ----------------------------- | --------------------------- | ---------------------------------- | ------------------ | ----------------- |
| Community Forensics ViT (2024-25)                | 0.87 / 0.77 / 0.69            | 1 / 1 / 1 of 379            | 5 / 0 / 0 of 200                   | 1 / 1 / 0          | 47 / 3 / 4        |
| Thermostatic frontier (Aug 2026)                 | 0.97 / 0.96 / 0.93            | 5 / 2 / 1 of 379            | 116 / 54 / 9                       | 104 / 104 / 70     | 131 / 100 / 74    |
| **Thermostatic low-quality (Aug 2026), shipped** | **0.97 / 0.96 / 0.92**        | **2 / 1 / 1 of 379**        | **149 / 59 / 10**                  | **105 / 109 / 71** | **124 / 94 / 68** |

Shipped: the low-quality model, which has the fewest false alarms and the best catch rate on the GPT portraits.

## What it means (picture model on its own)

- **On images as published, it catches half to three quarters** of these new generators' output (GPT portraits 75%, gpt-image-2.5 53%, Z-Image-Turbo 62%) while wrongly flagging 2 of 379 real photos.
- **Re-sharing hurts a lot for photo-realistic portraits:** GPT portraits drop to 30% as a social copy and 5% as a copy of a copy. The other two sources hold up better (about 50% as social copies, about 35% after two copies).
- **The first-generation Community Forensics model is close to useless on 2026 generators** at this strict setting (5 of 200 GPT portraits). The recent fine-tune is what makes this work.
- **It catches what provenance cannot.** On the owner's real downloads it scores the Perchance image (no label at all) and 3 of 5 chat-upload copies above the threshold; see the local test and the table below.

## On the owner's real downloads

Shipped gate and picture model, cut-off 6.27. These files are private and not committed.

| File                           | Provenance result | Photo gate                     | Picture model    | Combined                            |
| ------------------------------ | ----------------- | ------------------------------ | ---------------- | ----------------------------------- |
| ChatGPT original               | Made with AI      | not asked                      | not asked        | Made with AI                        |
| Gemini originals 1 and 2       | Made with AI      | not asked                      | not asked        | Made with AI                        |
| Copilot original               | Made with AI      | not asked                      | not asked        | Made with AI                        |
| Meta AI original               | Made with AI      | not asked                      | not asked        | Made with AI                        |
| Lovable original               | Made with AI      | not asked                      | not asked        | Made with AI                        |
| **Gemini chat copy 4**         | No clear signs    | plain photo (0.85)             | **above (12.1)** | **Likely made with AI**             |
| Gemini chat copy 2 (an ad)     | No clear signs    | has added text (0.09)          | not asked        | No clear signs, picture not checked |
| Gemini chat copy 3 (a comic)   | No clear signs    | has added text (0.09)          | not asked        | No clear signs, picture not checked |
| Gemini chat copies 1 and 5     | No clear signs    | not a plain photo (0.38, 0.33) | not asked        | No clear signs, picture not checked |
| **Perchance original (anime)** | No clear signs    | a drawing (0.10)               | not asked        | No clear signs, picture not checked |

The picture model alone scored the Perchance image far above the cut-off (11.9), and an earlier version of this page counted that as a catch. It is an anime drawing: the model gives human-made anime the same scores, so that "catch" was the false-alarm mechanism at work. The honest answer for it is "not checked". When a file declares AI, the gate and the picture model are not run at all.

Copies 1 and 5 look like photos, and the gate scores them just under its threshold: the gate also turns away some AI pictures it should let through (see the pass rates above).

## Limits

- **Plain photos only.** Drawings, paintings, screenshots and pictures with added text are not judged. An AI-made cartoon, poster or meme with no label gets "No clear signs, picture not checked". This is a real gap, chosen over false alarms.
- **The gate turns away some AI photos** (13% of GPT portraits, 25% of Z-Image-Turbo, 37% of gpt-image-2.5), partly because some of them are illustrations and partly because glossy AI pictures look "rendered" to the encoder.
- **Re-shared copies are mostly missed** for photo-realistic portraits (18.5% as a social copy, 3.5% as a copy of a copy).
- The counts are small: 6 of 1,065 is consistent with a true false-alarm rate between about 0.2% and 1.2%. Per kind (about 100 each) the numbers can only show "low", not how low.
- Phone photos are from SPAQ (2020 phones). Photos from current phones with heavy processing, portrait mode or beauty filters are not measured.
- AI sets: one GPT style collection, one gpt-image-2.5 set and one open model. Midjourney, Flux, Gemini and Grok output are not in this test.
- Neither model's weights are ours: both MIT-licensed, downloaded on first use from pinned revisions and verified by checksum.

## Engineering checks

- The TypeScript preprocessing matches Pillow byte for byte on real photos; the full TypeScript path (sharp decoding, our preprocessing, ONNX Runtime in Node) matches the Python evaluation path with a median score difference of 0 (largest 0.09, from JPEG decoders).
- Evaluation scored a float32 copy of the published float16 file (6x faster on CPU; scores differ by at most 0.07). For the shipped calibration, every image within 1 of the cut-off or above was rescored with the exact published float16 file.
- The gate's scores in the evaluation come from Pillow preprocessing; the shipped path uses the same byte-identical TypeScript preprocessing as the picture model.
