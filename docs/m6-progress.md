# M6 progress: standalone browser extension

Working notes for M6 (PLAN.md section 9). Decisions: [ADR-0013](decisions/0013-extension-architecture.md). Code: `apps/extension`.

## Stages

| #   | Stage                                                                                                                                                                                                                                      | Status                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| 1   | Extension skeleton: page reader, hidden engine page, side panel, scam rules, text check, site labels, file labels; browser tests                                                                                                           | done                                                     |
| 2   | Content Credentials in the browser (official library, trust list), checked against the plugin                                                                                                                                              | done                                                     |
| 3   | Picture model and photo gate in the browser: one-time download with checksum, same numbers as the plugin (test), progress in the panel                                                                                                     | done                                                     |
| 4   | Video: files by link (signature, then frames), and frames of a playing video for streamed video ("Check this video while it plays"); one colour conversion shared by plugin, extension and evaluation; evaluation redone, two calibrations | done                                                     |
| 5   | Background mode: a quiet mark on the toolbar button from the cheap checks (scam rules, site AI labels), can be switched off; right-click "Check this picture". No interrupting alerts yet (see findings)                                   | done                                                     |
| 6   | Accessibility: automated WCAG audit (axe-core) of every panel state in light and dark, keyboard use, text size, button size; tests run with every outside host blocked (works offline)                                                     | done                                                     |
| 7   | Packaging (zip for the Web Store, icons, licence list), README, results page                                                                                                                                                               | done; the try-out with 3 to 5 older users is the owner's |

## Findings so far

- **Both model files work in the browser on the CPU and give the plugin's numbers** (largest difference 0.005; 16 pictures). About 1.5 s per picture on one thread, 0.6 s on four, plus 0.2 s for the photo gate.
- **WebGPU is not used yet:** on the only GPU available for testing (a software one) it returned wrong numbers.
- **Decoding is identical** to the plugin for 15 of 16 test pictures. The exception was a phone photo with a rotation note in its metadata, which the browser applies and the plugin does not. The extension now reads the note and turns the picture back (`packages/core/src/image/orientation.ts`).
- **The whole picture check gives the plugin's numbers in the browser:** 17 pictures of eight kinds, including the rotated phone photo, checked in Chromium against the plugin path (photo-gate score within 0.01, picture-model score within 0.02; `apps/extension/test/models.local.test.ts`).
- **The one-time download works from the authors' pages:** both files (220 MB) arrived in 10 seconds on a fast connection and passed their checksums. A file with the right name and the wrong content is refused (tested).
- The hidden engine page can only use `chrome.runtime`: no storage and no tabs. Settings reach it inside requests.
- **Video frames must not be read through the browser's own colour conversion.** The first version drew the video onto a canvas, as web pages normally do. The same frames then scored 1 to 2 points away from the evaluation (up to 4.7 on single frames; the cut-off is 4.74), because a browser and ffmpeg turn the decoder's raw output (YUV) into RGB differently, and the picture model reacts to that. On a user's computer the graphics card would add a third variant.
- **The decoder's raw output is identical everywhere** (checked byte for byte between Chromium and ffmpeg on three clips). So every host now copies the raw planes and converts them with one fixed rule in the core (`packages/core/src/video/yuv.ts`, Python copy `eval/reference/yuv.py`, same bytes by test). With it, 84 frames from 14 clips score the same in the browser as in the plugin path (largest difference 0.007).
- **Consequence:** the video evaluation was scored again with this conversion and the frame check recalibrated (`video.frames@0.2.0`, plugin 0.5.0). Results: [M5 results](eval/m5-results.md).
- **A playing video needs its own cut-off.** Frames from one place in a video agree more than frames spread over it, so real videos reach higher numbers when watched (5 to 6 instead of 4.6). The frame check has two calibrations: files (cut-off 4.65) and playing video (6.21). Watching a re-encoded AI video catches 8%; files 40%.
- **Speed:** twelve pictures in 15 to 21 seconds on four cores.
- **Streamed video works:** the page reader copies raw frames from the playing video (it never plays, pauses or seeks it), about one per second of video, and the engine judges them. Tested with a real AI clip (flagged) and a real studio clip (not flagged). Protected video and paused video are reported as such.
- Browsers cannot play some old formats (the OpenVid test clips use MPEG-4 Part 2); such files are "not checked".
- **Accessibility audit:** no violations of WCAG 2.0, 2.1 and 2.2 (levels A and AA) or of axe-core's best-practice rules, before a check, with a scam warning, with picture and video results, in large-text mode, in light and dark colours. All text is at least 18 px (22 px in large-text mode), every button is at least 44 px high, everything works with the keyboard, and after a check the reading position moves to the result. An automated audit does not replace trying it with real people; that is the owner's try-out.
- **Works offline:** all browser tests run with every host except the test computer blocked, including the model download (pointed at a local copy) and the checks after it.
- **No interrupting alerts in this version.** The scam rules were built and measured on messages. On 3,778 long human-written texts (news, essays, stories, student writing) they flag 27 (0.7%): 6 "high" (5 of them fiction with threats in the plot) and 21 "medium". That is rare enough for a quiet mark on the toolbar button, and too often for something that interrupts a person on every such page. `pnpm eval` prints this table when the text datasets are present.
- A result belongs to one page: when the person moves to another page or tab, the panel takes the old result away.
- **Content Credentials give the same answer as in the plugin** on every test file: our fixtures, the 26 official C2PA test images, and real ChatGPT, Gemini, Copilot and Sora 2 files (`apps/extension/test/c2pa.test.ts`). The extension uses the WebAssembly build of the official library directly; the library's own browser wrapper starts a worker from generated code, which Chrome does not allow in extensions.
- Chrome gives extension pages a small default text size; the panel sets its own (18 px, 22 px in large-text mode).

## How to try it

```bash
pnpm --filter @isitreal/extension build
```

Then in Chrome: `chrome://extensions`, switch on Developer mode, "Load unpacked", choose `apps/extension/dist`. Open a page, click the extension's button, press "Check this page".
