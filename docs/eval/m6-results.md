# M6 results: the browser extension

**Date:** 2026-11-11 · Extension 0.1.0 (`apps/extension`), engine `0.8.0-m6` · Decision record: [0013](../decisions/0013-extension-architecture.md) · Working notes: [m6-progress.md](../m6-progress.md)

The extension runs the same detection core as the Claude plugin. So this page does not measure detection again (that is in [EVAL.md](../../EVAL.md)); it checks the one thing that could make those numbers untrue in a browser: **does the browser give the checks the same input and the same numbers?** And it reports what is specific to the extension: accessibility, working offline, speed, and the quiet background check.

## Same numbers as the plugin and the evaluation

| What                         | How it was checked                                                                                                                                                                    | Result                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Content Credentials          | Both readers (native library in the plugin, WebAssembly build in the extension) on our fixtures, the 26 official C2PA test images, and real ChatGPT, Gemini, Copilot and Sora 2 files | Same state, signer, AI declaration and failure codes on every file                            |
| Decoding a picture           | Pixels from the browser against pixels from the plugin's decoder, 16 pictures                                                                                                         | Identical for 15; the 16th is a phone photo with a rotation note, now turned back (see below) |
| Picture model and photo gate | 17 pictures of eight kinds in Chromium (ONNX Runtime Web, CPU) against the plugin path                                                                                                | Photo gate within 0.01, picture model within 0.02 (cut-off 6.27)                              |
| Video frames                 | 84 frames from 14 clips, read by the browser's video player and by the plugin's ffmpeg at the same moments                                                                            | Photo gate within 0.001, picture model within 0.01                                            |
| Watching a streamed video    | A Seedance clip and a studio recording delivered as streams, watched while playing                                                                                                    | The AI clip is flagged, the real one is not                                                   |
| Model download               | Both files from the authors' pages in Chromium, 220 MB                                                                                                                                | Arrived in 10 seconds on a fast line, checksums correct; a wrong file is refused              |

Tests: `apps/extension/test/c2pa.test.ts` (runs everywhere), `apps/extension/test/models.local.test.ts` (needs the model files and evaluation images, so it runs only where they are).

### Three things the browser does differently, and what was done

1. **Photo rotation.** Phones store photos sideways with a note "show me turned". A browser always applies the note; the plugin and the evaluation read the stored pixels. The extension reads the note and turns the picture back, so the picture model sees what it was calibrated on.
2. **Video colour.** A browser's way of turning a decoder's raw output into RGB differs from ffmpeg's, and the picture model reacts to it: the same frames scored 1 to 2 points apart (single frames up to 4.7; the cut-off is below 5). The decoder's raw output is identical everywhere, so every host now converts it with one rule in the core. This changed the plugin and the evaluation too: [M5 results](m5-results.md), decision record 0012.
3. **Graphics card.** The model runs on the processor (WebAssembly). On the only graphics card available for testing, a software one, the WebGPU backend returned wrong numbers. It stays off until it can be tested on real hardware.

## Accessibility

Automated audit with axe-core in Chromium (`apps/extension/test/a11y.e2e.test.ts`), rules for WCAG 2.0, 2.1 and 2.2 at levels A and AA plus axe's best-practice rules:

| Panel state                               | Light colours | Dark colours  |
| ----------------------------------------- | ------------- | ------------- |
| Before a check                            | no violations | no violations |
| Scam warning with advice, picture results | no violations | no violations |
| Video results, large-text mode            | no violations | not run       |

Also tested: all text is at least 18 px (22 px in large-text mode, and the choice is remembered); buttons are at least 44 px high; the main button is the first keyboard stop and shows a focus ring; every control is reachable with Tab; after a check the reading position moves to the result; large text does not push content off a narrow panel. Results are words and symbols, never colour alone; the result can be read aloud.

**Not done:** a screen-reader session with a person, and the try-out with 3 to 5 older users. An automated audit finds perhaps a third of real accessibility problems; these two find the rest.

## Works offline

Every browser test runs with all hosts except the test computer blocked. The page check, Content Credentials, the picture check (after its files were fetched from a local copy) and video all work that way. The only requests the extension makes are for the page's own pictures and video files, and once for the two model files.

## Speed

On a four-core computer, on the processor only: a page with twelve pictures (three of them 12-megapixel phone photos) took 21 seconds the first time, which includes loading both models, and 15 seconds after that, a little over a second per picture. The panel shows progress. A streamed video takes the six seconds of watching plus two or three of checking.

## The quiet check as pages open

The background mode runs the scam rules and the site-label matcher on each page's text, fetches nothing, and marks the toolbar button. The scam rules were built on messages, so they were measured on long human-written texts as a stand-in for ordinary pages:

| 3,778 human-written texts (news, essays, stories, student writing) | Marked                                                |
| ------------------------------------------------------------------ | ----------------------------------------------------- |
| Red mark ("looks like a scam")                                     | 6 (0.16%), 5 of them fiction with threats in the plot |
| Amber mark ("some warning signs")                                  | 21 (0.56%)                                            |

This is why the extension does not interrupt with a banner or a pop-up: on a wrong mark, nothing is lost; a wrong interruption costs trust. Real web pages (shop pages, bank pages, forums) were not measured.

## Limits

- Chrome and Chromium browsers only; Firefox is not built.
- Pictures are downloaded a second time by the extension, without cookies. A site that only serves pictures to logged-in visitors gets "could not load this picture".
- Streamed video is checked only when the person asks and the video plays; protected (DRM) video cannot be read.
- Text and pictures inside embedded pages are not read (videos are).
- Detection limits are those of the core: see [EVAL.md](../../EVAL.md).
