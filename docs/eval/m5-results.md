# M5 results: video

**Date:** 2026-11-12 (second version; the first, of 2026-11-11, used a different way of reading frames, see "What changed") · Shipped: `video.c2pa@0.1.0`, `video.metadata@0.1.0`, and the experimental frame check `video.frames@0.2.0` (uses `image.classifier.commfor-lq@0.1.0` behind `image.photo-gate@0.2.0`) · Plugin 0.5.0, extension 0.1.0 · Decision record: [0012](../decisions/0012-video-frame-check.md)

Reproduce: `python3 -I eval/reference/video_data.py` (downloads the clips, about 6 GB), `python3 -I eval/reference/video_eval.py` and `python3 -I eval/reference/video_window_eval.py` (about 3 hours together on 4 cores; both can be stopped and restarted), `pnpm --filter @isitreal/eval run gate:train`, then `pnpm eval`. The score tables `eval/features/video-scores.v1.jsonl` and `eval/features/video-window-scores.v1.jsonl` are committed (numbers only), so `pnpm eval` and `python3 -I eval/reference/video_analysis.py` work without the clips.

## What the video check does

1. **Labels and signatures first.** Content Credentials in MP4 and MOV files, the "made by AI" metadata label, and AI labels the site shows next to the video. A declaration gives _Made with AI_ and nothing else is run.
2. **Frame check, only when nothing is declared.** Six still frames are taken. Each goes through the photo gate (is this a plain camera-style picture?) and, if it passes, the picture model. The video's number is the **median** score of the frames that passed. With fewer than 4 such frames the video is **not checked**. The number is compared with real videos, not with the cut-off for still images.

Frames are taken in one of two ways, and each has its own calibration:

- **A video file** (plugin, and files by link in the extension): six frames spread over the whole clip.
- **A video that is playing** (extension, for streamed video): six frames about a second apart, from wherever playback is. The extension only looks; it does not move the video.

The frame rule (six frames, median, at least four) was fixed before any video was scored.

## Test set

1,247 clips. Each is scored as the file is and as a **re-shared copy** (at most 480 pixels high, H.264 at quality 30, the kind of copy a chat app or a video site makes). Every source is split in half by a hash of the file name: one half for calibration and comparisons, the other half only for the numbers on this page.

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

## Frame check on video files (test half)

Calibration: 164 non-AI calibration videos that the gate lets through (71 OpenVid, 50 studio, 43 MSR-VTT), each with the higher number of its two versions. _Likely made with AI_ needs a conformal score of at least 0.99, which with 164 videos means a number above every one of them (raw cut-off 4.65).

| Not AI: wrongly flagged   | As the file is                | Re-shared copy         |
| ------------------------- | ----------------------------- | ---------------------- |
| Studio recordings (50)    | 0 (not checked 4%)            | 0 (not checked 8%)     |
| YouTube clips, 2016 (66)  | 0 (not checked 27%)           | 0 (not checked 24%)    |
| YouTube clips, HD (69)    | 2 (not checked 19%)           | 0 (not checked 17%)    |
| **All 185 non-AI videos** | **2 (1.1%)**, not checked 18% | **0**, not checked 17% |

| AI: caught by the frame check | As the file is            | Re-shared copy            |
| ----------------------------- | ------------------------- | ------------------------- |
| Wan 2.1 (24)                  | 67% (not checked 17%)     | 33%                       |
| Runway Gen-3 Alpha (23)       | 65% (30%)                 | 13%                       |
| Seedance 1 Pro (27)           | 63% (30%)                 | 33%                       |
| Pika 2.2 (20)                 | 60% (40%)                 | 50%                       |
| AI talking portraits (60)     | 57% (38%)                 | 20%                       |
| Kling (27)                    | 56% (0%)                  | 22%                       |
| Veo 3.1 (29)                  | 48% (28%)                 | 14%                       |
| Sora, first version (20)      | 45% (35%)                 | 15%                       |
| Veo 2 (28)                    | 43% (46%)                 | 11%                       |
| HunyuanVideo (19)             | 37% (26%)                 | 11%                       |
| Luma Ray 2 (23)               | 35% (17%)                 | 4%                        |
| Veo 3 (23)                    | 30% (65%)                 | 9%                        |
| Mochi 1 (27)                  | 15% (19%)                 | 7%                        |
| **Sora 2 (27)**               | **4%** (7%)               | **0%**                    |
| **Face swaps (49)**           | **0%** (0%)               | **0%**                    |
| **All 426 AI videos**         | **40%** (not checked 26%) | **15%** (not checked 27%) |

## Frame check on a playing video (test half)

The same clips, with six frames about a second apart from one place in the clip. Frames from one place agree with each other more than frames from all over a video, so a real video's number swings further: the same few real clips that reach 4.6 as files reach 5 to 6 this way. This way of looking therefore has its own, higher cut-off (6.21, from 162 calibration videos).

| A playing video                             | Wrongly flagged (185 non-AI videos) | AI caught (426 AI videos) |
| ------------------------------------------- | ----------------------------------- | ------------------------- |
| As the file is                              | 0, not checked 18%                  | not scored                |
| Re-shared copy (what a video site delivers) | 0, not checked 16%                  | **8%**, not checked 27%   |

By generator, re-shared and playing: Seedance 1 Pro 37%, Wan 2.1 21%, Pika 2.2 20%, HunyuanVideo 16%, Veo 3.1 14%, talking portraits 8%, Kling 7%, Veo 3 4%, Veo 2 4%; Sora, Sora 2, Runway, Luma Ray 2, Mochi 1 and face swaps 0%.

## What a person gets in the end

Labels and the frame check together, on the 426 AI test videos:

| AI test videos                                                                   | The file itself: _Made with AI_ or _Likely made with AI_ | A re-shared file (labels gone) | Watched on a video site (re-encoded, playing) |
| -------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------ | --------------------------------------------- |
| Current generators: Veo 3.1, Veo 3, Sora 2, Kling, Seedance 1 Pro, Wan 2.1 (157) | 61% (17% by signature)                                   | 18%                            | 14%                                           |
| Older generators (160)                                                           | 54% (27% by signature)                                   | 15%                            | 5%                                            |
| AI talking portraits (60)                                                        | 68% (20% by signature)                                   | 20%                            | 8%                                            |
| Face swaps (49)                                                                  | 0%                                                       | 0%                             | 0%                                            |
| **All (426)**                                                                    | **52%**                                                  | **15%**                        | **8%**                                        |

On a video site the site's own label ("Altered or synthetic content" and the like) also counts, and is often the only thing that does.

## What this means

- **It stays quiet on real video.** 2 of 185 real test videos were wrongly flagged as files (1.1%), none as re-shared copies, none while playing. The test set is small: with 185 videos the true rate for files could be as high as about 4%.
- **About half of AI video files are recognised, one in seven after re-sharing, one in twelve when watched on a video site.** Every step away from the original file loses something: the signature, then fine detail, then the spread of frames.
- **Sora 2 is recognised only by its signature.** Every Sora 2 file carries one, so the original file gives _Made with AI_. Its frames look like camera footage to the picture model, so a re-shared or streamed Sora 2 clip is **not** caught.
- **Face swaps are not caught at all** (0 of 49). Only the face is changed; the rest of every frame is real footage. A "deepfake" of a real person needs a different kind of check (lip-sync, face boundaries), which is not part of this version.
- **One video in four is not checked.** Animated or stylised video and video with captions or graphics over it do not pass the photo gate, the same as for images.

## What changed since the first version of this page

The first version (plugin 0.4.0) let ffmpeg turn each frame into RGB. Building the browser extension showed that this step is not neutral: a decoder's raw output (YUV) can be turned into RGB in several accepted ways, a browser does it differently from ffmpeg, and the picture model's score moves by 1 to 2 points with it (up to 4.7 on single frames). The raw output itself is identical everywhere, bit for bit. So frames are now taken raw and converted by one rule in the core, in the plugin, the extension and this evaluation (decision record 0012, amendment).

Everything was scored again. For video files the picture is the same, a little better: 40% of AI files caught by frames instead of 34%, 15% of re-shared copies as before, 2 real videos flagged instead of 1. The plugin no longer accepts screenshots of a video as frames: a screenshot is exactly the uncontrolled path.

## What was tried and not shipped

**Other ways to combine the frames** (mean, highest, second highest, lowest), compared on the calibration half only: all below the median (32% to 40% of AI files against 44%). Requiring only 2 or 3 judged frames instead of 4 catches 4 to 7 points more, because fewer videos are "not checked". The rule fixed beforehand was kept; judging a video from two frames is a candidate for a later version, to be tested on new clips.

**One cut-off for files and playing video.** It would have to be the higher one, and detection on files would fall from 40% to 32% (re-shared: 15% to 8%). Two calibrations keep each way at its own honest level.

**Motion statistics.** Ten numbers per video on how consecutive frames differ (motion, jerk, flicker, noise that stays or changes, detail that comes and goes), read by a logistic model. With every source seen in training it caught 3% of AI video. With a source of real video held out, it wrongly flagged 9% to 87% of that source. It had learned the collections (frame rate, resolution, compression), not AI video. Not shipped. `python3 -I eval/reference/video_analysis.py` prints both comparisons.

## Checks on the measurement itself

- **One conversion, same bytes.** The TypeScript rule and its Python copy give identical bytes on made-up frames of odd sizes, both colour rules and both ranges (`packages/core/test/yuv.test.ts`).
- **Same numbers in the plugin as here.** On 21 clips from seven sources the plugin's path gives the same frames judged and a video number within 0.15 (`packages/mcp-server/test/video.local.test.ts`; the evaluation uses the float32 copy of the picture model, the plugin the float16 file).
- **Same numbers in the browser as in the plugin.** 84 frames from 14 clips, read by Chromium's video player and by the plugin's ffmpeg at the same moments: photo gate within 0.001, picture model within 0.01 (`apps/extension/test/models.local.test.ts`).
- **Watching works end to end.** In Chromium, a Seedance clip delivered as a stream is flagged while it plays and a studio recording is not (same test file).
- A bug found on the way: with the frame check on, a broken signature was no longer mentioned in the answer. Fixed.
- Speed in the plugin: 3 to 15 seconds per video on 4 cores (the first one includes loading the models).

## Limits of this evaluation

- Real video: three collections, 185 test clips. No clips straight from a phone camera, no screen recordings, no video calls, no clips with beauty filters. These are the cases to measure next.
- "Watched on a video site" is simulated: our own re-encode, frames a second apart. Real sites re-encode in their own ways and at several qualities.
- The AI clips come from prompt collections made for comparing generators; scam videos in the wild may be edited, cropped or filmed off a screen.
- Each generator has 19 to 29 test clips, so single rows can move by ten points or more with new clips.
- Only 8-bit 4:2:0 video is read (nearly all web video). Browsers cannot play some old formats (the OpenVid clips use MPEG-4 Part 2), so in the extension those files are "not checked".
- MSR-VTT clips are small and have 3 frames a second. They are fine for false alarms on single frames and useless for motion.
