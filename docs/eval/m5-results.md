# M5 results: video

**Date:** 2026-11-11 · Shipped: `video.c2pa@0.1.0`, `video.metadata@0.1.0`, and the experimental frame check `video.frames@0.1.0` (uses `image.classifier.commfor-lq@0.1.0` behind `image.photo-gate@0.2.0`) · Plugin 0.4.0 · Decision record: [0012](../decisions/0012-video-frame-check.md)

Reproduce: `python3 -I eval/reference/video_data.py` (downloads the clips, about 6 GB), `python3 -I eval/reference/video_eval.py` (about 4 hours on 4 cores; it can be stopped and restarted), `pnpm --filter @isitreal/eval run gate:train`, then `pnpm eval`. The score table `eval/features/video-scores.v1.jsonl` is committed (numbers only), so `pnpm eval` and `python3 -I eval/reference/video_analysis.py` work without the clips.

## What the video check does

1. **Labels and signatures first.** Content Credentials in MP4 and MOV files, the "made by AI" metadata label, and AI labels the site shows next to the video. A declaration gives _Made with AI_ and nothing else is run.
2. **Frame check, only when nothing is declared.** Six still frames are read at even steps through the video. Each frame goes through the photo gate (is this a plain camera-style picture?) and, if it passes, the picture model. The video's number is the **median** score of the frames that passed. With fewer than 4 such frames the video is **not checked**. The number is compared with real videos (below), not with the cut-off for still images.

The frame rule (six frames, median, at least four) was fixed before any video was scored.

## Test set

1,247 clips, each scored twice: as the file is, and as a **re-shared copy** (at most 480 pixels high, H.264 at quality 30, the kind of copy a chat app makes). Every source is split in half by a hash of the file name: one half for calibration and comparisons, the other half only for the numbers on this page.

| Kind              | Clips | Source                                                                                                                                          |
| ----------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Not AI            | 120   | MSR-VTT: YouTube clips collected in 2016 (small copies, 3 frames a second)                                                                      |
| Not AI            | 150   | OpenVid-1M: HD YouTube clips                                                                                                                    |
| Not AI            | 100   | DeepFakeDetection originals: studio recordings of actors                                                                                        |
| AI, text-to-video | 650   | 50 each of Veo 3.1, Veo 3, Veo 2, Sora 2, Sora, Kling, Seedance 1 Pro, Wan 2.1, Luma Ray 2, Pika 2.2, Runway Gen-3 Alpha, HunyuanVideo, Mochi 1 |
| AI, talking faces | 127   | Synthetic portrait videos (Netherlands Forensic Institute): Kling, Luma, Pika, PixVerse, Runway, Sora                                           |
| AI, face swaps    | 100   | DeepFakeDetection (2019): the same actors with another face put on                                                                              |

The clips are downloaded at evaluation time and are not redistributed. Licences and exact origins are in `eval/reference/video_data.py`.

## Labels and signatures on the AI files

Counted on all AI clips as downloaded (test: `packages/c2pa-node/test/video.test.ts`):

| Source                            | Signed "made with AI" record                                            |
| --------------------------------- | ----------------------------------------------------------------------- |
| Sora 2                            | 50 of 50 (signed by OpenAI; certificate not fully up to the standard)   |
| Sora (first version)              | 50 of 50                                                                |
| Runway Gen-3 Alpha                | 50 of 50                                                                |
| AI talking portraits              | 26 of 127; another 20 have a record that broke when the file was edited |
| Veo, Kling, Seedance and the rest | 0                                                                       |

These are the collections' copies. A file that was re-encoded before it was collected has lost its record, so "0" does not prove the generator adds none. A re-shared copy never has one.

## Frame check: results on the test half

Calibration: 164 non-AI calibration videos that the gate lets through (71 OpenVid, 50 studio, 43 MSR-VTT), each with the higher number of its two versions. _Likely made with AI_ needs a conformal score of at least 0.99, which with 164 videos means a number above every one of them (raw cut-off 4.74).

| Not AI: wrongly flagged   | As the file is                | Re-shared copy         |
| ------------------------- | ----------------------------- | ---------------------- |
| Studio recordings (50)    | 0 (not checked 4%)            | 0 (not checked 6%)     |
| YouTube clips, 2016 (66)  | 0 (not checked 23%)           | 0 (not checked 18%)    |
| YouTube clips, HD (69)    | 1 (not checked 17%)           | 0 (not checked 17%)    |
| **All 185 non-AI videos** | **1 (0.5%)**, not checked 16% | **0**, not checked 15% |

| AI: caught by the frame check | As the file is            | Re-shared copy            |
| ----------------------------- | ------------------------- | ------------------------- |
| Seedance 1 Pro (27)           | 63% (not checked 30%)     | 37%                       |
| Wan 2.1 (24)                  | 63% (17%)                 | 29%                       |
| Runway Gen-3 Alpha (23)       | 61% (30%)                 | 13%                       |
| Pika 2.2 (20)                 | 60% (40%)                 | 45%                       |
| Sora, first version (20)      | 50% (30%)                 | 10%                       |
| AI talking portraits (60)     | 47% (37%)                 | 22%                       |
| Veo 3.1 (29)                  | 41% (31%)                 | 17%                       |
| Kling (27)                    | 33% (0%)                  | 19%                       |
| Veo 2 (28)                    | 29% (50%)                 | 11%                       |
| Veo 3 (23)                    | 26% (65%)                 | 9%                        |
| Luma Ray 2 (23)               | 26% (17%)                 | 0%                        |
| HunyuanVideo (19)             | 21% (26%)                 | 5%                        |
| Mochi 1 (27)                  | 11% (22%)                 | 7%                        |
| **Sora 2 (27)**               | **4%** (7%)               | **0%**                    |
| **Face swaps (49)**           | **0%** (0%)               | **0%**                    |
| **All 426 AI videos**         | **34%** (not checked 26%) | **15%** (not checked 27%) |

## What the plugin says in the end

Labels and the frame check together, on the 426 AI test videos:

| AI test videos                                                                   | As the file is: _Made with AI_ or _Likely made with AI_ | Re-shared copy (labels gone) |
| -------------------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------- |
| Current generators: Veo 3.1, Veo 3, Sora 2, Kling, Seedance 1 Pro, Wan 2.1 (157) | 55% (17% by signature)                                  | 18%                          |
| Older generators (160)                                                           | 48% (27% by signature)                                  | 13%                          |
| AI talking portraits (60)                                                        | 65% (20% by signature)                                  | 22%                          |
| Face swaps (49)                                                                  | 0%                                                      | 0%                           |
| **All (426)**                                                                    | **47%**                                                 | **15%**                      |

## What this means

- **It stays quiet on real video.** 1 of 185 real test videos was wrongly flagged as a file, none as a re-shared copy. The test set is small: with 185 videos the true rate could be as high as about 3%.
- **About half of AI video files are recognised, one in seven after re-sharing.** A video that arrives through a chat app or is re-uploaded has lost its signature and much of the fine detail the picture model reads.
- **Sora 2 is recognised only by its signature.** Every Sora 2 file carries one, so the original file gives _Made with AI_. Its frames look like camera footage to the picture model (1 of 27 flagged), so a re-shared Sora 2 clip is **not** caught.
- **Face swaps are not caught at all** (0 of 49). Only the face is changed; the rest of every frame is real footage. A "deepfake" of a real person needs a different kind of check (lip-sync, face boundaries), which is not part of this version.
- **One video in four is not checked.** Animated or stylised video and video with captions or graphics over it do not pass the photo gate, the same as for images.
- **Streamed video is the common case and the weakest one.** YouTube, Facebook and TikTok deliver video in pieces, so the plugin has no file: only the site's labels count, unless screenshots of the playing video are saved and passed in. That path works but was not measured.

## What was tried and not shipped

**Other ways to combine the frames** (mean, highest, second highest, lowest), compared on the calibration half only: within three points of the median (35% to 40% against 38% as files). Requiring only 2 or 3 judged frames instead of 4 catches 4 to 6 points more, because fewer videos are "not checked". The rule fixed beforehand was kept; judging a video from two frames is a candidate for a later version, to be tested on new clips.

**Motion statistics.** Ten numbers per video on how consecutive frames differ (motion, jerk, flicker, noise that stays or changes, detail that comes and goes), read by a logistic model. With every source seen in training it caught 3% of AI video. With a source of real video held out, it wrongly flagged 9% to 87% of that source. It had learned the collections (frame rate, resolution, compression), not AI video. Not shipped. `python3 -I eval/reference/video_analysis.py` prints both comparisons.

## Checks on the measurement itself

- **Same numbers in the plugin as here.** The evaluation scores frames in Python with the system ffmpeg (6.1); the plugin uses TypeScript and a packaged ffmpeg (7.0). On 21 clips from seven sources the plugin gives the same verdict inputs: same frames judged, video number within 0.15 (`packages/mcp-server/test/video.local.test.ts`).
- The evaluation uses the float32 copy of the picture model, the plugin the float16 file (largest difference measured: 0.07 on a scale where the cut-off is 4.74).
- A bug found on the way: with the frame check on, a broken signature was no longer mentioned in the answer. Fixed; what the signature check finds now stays in the answer whatever the frame check says.
- Speed in the plugin: 3 to 15 seconds per video on 4 cores (the first one includes loading the models).

## Limits of this evaluation

- Real video: three collections, 185 test clips. No clips straight from a phone camera, no screen recordings, no video calls, no clips with beauty filters. These are the cases to measure next.
- The AI clips come from prompt collections made for comparing generators; scam videos in the wild may be edited, cropped or filmed off a screen.
- Each generator has 19 to 29 test clips, so single rows can move by ten points or more with new clips.
- MSR-VTT clips are small and have 3 frames a second. They are fine for false alarms on single frames and useless for motion.
