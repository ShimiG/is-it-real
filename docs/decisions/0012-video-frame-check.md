# 0012: Video: labels first, then an experimental frame check

**Status:** accepted (2026-11-11)

## Context

The plan puts video in the first version. Training a video detector is out of reach for this project (data, GPUs), and published video detectors are large and tied to the generators they were trained on. What we already have is a picture model and a photo gate that were measured on still images (ADR-0011), and a Content Credentials reader that also reads MP4 and MOV files. Measurements: [docs/eval/m5-results.md](../eval/m5-results.md).

## Decision

- **Labels and signatures first** (as for images, ADR-0010): Content Credentials in the file, the "made by AI" metadata label, and labels the site shows. A declaration gives _Made with AI_ and no statistical check runs.
- **Otherwise an experimental frame check:** six frames at even steps, each through the photo gate and the picture model; the video's number is the median of the frames that pass; fewer than four passing frames means _Not checked_ (`video_not_plain_footage`). The rule was fixed before any video was scored.
- **Its own calibration.** The video number is compared with real videos (each calibration video as a file and as a re-shared copy, the higher number kept), not with the cut-off for still images. Same strict setting as everywhere (ADR-0006).
- **Shipped switched on, labelled experimental.** Every answer that used it carries a note saying so. `ISITREAL_NO_VIDEO=1` turns it off.
- **Frames are read by ffmpeg as a separate program**, never by code inside the server: the container type is read from the first bytes and forced, only local files are allowed as input, there is a time limit, and frames come back over a pipe. The plugin uses `ISITREAL_FFMPEG` if set, else an `ffmpeg` already on the computer, else it installs the `ffmpeg-static` package into its data folder on first use. That program is GPL software; it is downloaded by the user's npm, not redistributed by this project, and not linked into our code.
- **Motion statistics are not used.** They were measured and only separated the collections from each other (results page).
- **Face-swap "deepfakes" are out of scope for this check**, and the product says so: for a video with _No clear signs_ the answer always adds that this cannot rule out AI or a deepfake.
- **Rule from ADR-0011 applies:** the plugin path and the evaluation path must give the same numbers, checked by a test on real clips.

## Consequences

- AI video files with no label can get _Likely made with AI_: about a third of them in our test, one in seven after re-sharing, with 1 of 185 real videos wrongly flagged.
- Sora 2 is recognised by its signature only; a re-shared Sora 2 clip is missed. Face swaps are missed entirely.
- Streamed video (most video on the web) cannot be fetched as a file by the plugin. Only labels count there, unless screenshots of the playing video are passed in. The browser extension can read frames from the page itself; that is where this check becomes useful for everyday browsing.
- First use downloads about 80 MB more when the computer has no ffmpeg.
- The calibration set is small (164 videos). More real video of more kinds (phone clips, screen recordings, video calls) is the first thing to add.
