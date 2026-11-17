# M6 results: the browser extension

**Date:** 2026-11-11 · Extension 0.1.8 (`apps/extension`), engine `0.8.6-m6` · Decision record: [0013](../decisions/0013-extension-architecture.md) · Working notes: [m6-progress.md](../m6-progress.md)

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

## First report from real use (2026-11-16)

The owner tried version 0.1.0 on everyday pages and reported two things.

1. **A video page was marked for the words "explained in 20 minutes".** The scam rules counted any "in N minutes" as time pressure, and the panel showed one weak sign in warning colours. Fixed in 0.1.1 (scam rules 0.1.1): a time limit now counts only next to a main sign (a request, a threat, an unusual payment, a bad link), and one small sign on its own is shown calmly, like "nothing found", with the sign named. Every scam in the test sets is still caught (40 of 40, 25 of 25); the regression is a test.
2. **Pictures on an AI image generator's site got "No clear signs".** Version 0.1.1 added **Save a report for the developer** (a file with the numbers behind each result), and the owner sent three reports. They showed:
   - **Five of the six generator pictures are in a painted or illustrated style.** The photo gate kept them out (gate scores 0.00 to 0.21), although the picture model scored most of them very high (11 to 14; the cut-off for photos is 6.27). The sixth looked like a photo and scored 4.5: a miss, within the measured miss rate.
   - **Could such pictures be judged against a higher cut-off of their own?** Measured (`python3 -I eval/reference/image_art_analysis.py`): a cut-off from all human-made drawings, paintings, screenshots and memes (11.52) catches 28% of AI pictures of this kind but flags 3 of 89 human digital paintings; a cut-off that tries to protect digital paintings (13.89) still flags 2 of 89 and catches 7%. At the top of the scale human digital paintings and AI pictures score the same. Wrongly calling a human artist's work AI is a harm this project will not trade for detection, so these pictures stay unjudged.
   - **The real fault was the wording.** An unjudged picture was shown as _No clear signs_, which reads as "we looked and found nothing". From 0.1.2 a picture or video that a check refused to judge is _Not checked_, with the reason ("cannot tell human-made pictures of this kind from AI-made ones").
   - **Five icon files (SVG) were listed as pictures that could not be read.** Vector drawings are now left out.
3. **Two ordinary pages got "some warning signs" for a link.** A newspaper's own "Facebook" button, and an address in a YouTube description that YouTube routes through itself, were read as "a link says one address but goes somewhere else". From scam rules 0.1.2: a link that stays on the page's own site is not a mismatch (unless it is written as a well-known brand's address, the fake-login trick); a site's "you are leaving" link is followed to its real destination; on a page, a button that only names a brand is not judged. In a message all of it still counts. Every scam in the test sets is still caught.
4. **A YouTube Short with "a clear AI tag" was not recognised.** The next report (0.1.2) listed the label-like texts on the page and settled it: the tag was the uploader's own hashtags in the title (`#aislop #ai`), not a YouTube label. That report's video was flagged by the frame check (10.8, cut-off 6.2); the first try, at another moment of the video, was not, which is how a check that looks at six frames behaves. The page also carried YouTube's "AI-generated video summary" and a script fragment among the texts, which must not count as labels.
   - From 0.1.3, **what the page itself says about an item is used as a hint** (decision record 0014): a caption or alt text, the uploader's tags, or the file's name. It gives _Likely made with AI_ with the words quoted, never _Made with AI_. This also answers the generator site: its pictures are named `ai-generated-image-N.png`.
   - Its false-alarm rate is not measured; the patterns were written against the look-alike phrases in the reports ("AI-generated video summary", "AI image generator", a bare `#ai`).
5. On the newspaper page, the one picture that was flagged (score 13.9, photo-like) illustrates an article about AI-made pictures.
6. **A Facebook reel with Meta's AI label was not recognised.** The owner's Facebook is set to Hebrew. The page reader saw the label ("תוכן שנוצר באמצעות AI"), but the label matcher only knew the English wordings. From 0.1.4 it knows Meta's label names in English and Hebrew, including the newer "AI content" and "AI creator" from Meta's help article. Labels are per language, so every other language is still missing; what is covered is listed in [platform-labels.md](../platform-labels.md). The matcher's rule for "any site" was removed at the same time: it had produced the four false hits in the browsing census, and a text on an unknown site is now a hint (item 4), not a label.
7. **"The video is not playing" on a Facebook reel that was playing.** Reel pages keep the next clips loaded, paused, at the same size as the one on screen; the watch button had picked one of those. From 0.1.5 the video being watched is chosen: most of it on screen, playing before paused; and if the page changed since the check, the video that is running is taken.
8. **The label was reported, but not on the video.** On a video's own page (a reel, a short, a watch page) the site's label is now reported on the video's card; on a feed it stays a line of its own.
9. **A real video's thumbnail was marked "Likely made with AI"** (score 7.8, cut-off 6.27, photo gate 0.57). Checked against the evaluation: stills from real videos behave like other real pictures. Of 309 real test videos' stills none is above the cut-off; of all 1,832 single frames, 5 are (0.3%; 1.2% for HD YouTube clips). Adding video stills to the calibration would not move the cut-off. So this is the mistake rate the check is built to: about 1 real picture in 100. A page with a dozen pictures therefore shows a wrong mark about once in ten checks, which a person should know: from 0.1.5 the reason itself says "About 1 real photo in 100 gets this result by mistake."
10. **An AI-made Instagram reel got "No clear signs", though Instagram labels it.** Two separate things. The frame check looked at six frames and found nothing (score -0.4), which is the usual outcome: it catches about 8% of AI video on video sites. And Instagram showed its label only in the reel's "about" panel, which is not on the page until the person opens it; the tool never clicks. Opening it first and then checking is the way to have it read ([platform-labels.md](../platform-labels.md)).
11. **Five reports from Instagram, taken together (0.1.5).** The owner's summary: "flagged, but inconsistently". The numbers behind that, over 44 pictures and 6 watched videos:
    - **Most openly AI-made content there has the rendered look the photo gate keeps out.** 18 of the 44 pictures were _Not checked_ for that reason, and 11 of those 18 score above the cut-off for photos. On one post from an account that describes itself as AI-made, 9 of 12 pictures were kept out (gate 0.03 to 0.25) while scoring 10.4 to 14.3; the 2 that were flagged sat exactly on the gate's line (0.50, 0.51), and one more scored 5.9, just under the cut-off of 6.27. So which pictures get a result depends on small differences in look. That is the inconsistency. The higher bar that was measured and rejected in item 2 (11.52) would have flagged 6 of those 9; it would also flag about 1 in 30 human digital paintings, which is why it is not used.
    - **Watched videos: 1 of 6 flagged** (score 12.8), 2 "No clear signs", and 3 _Not checked_ because too few frames looked like plain footage. Half of what a person watches there cannot be judged at all.
    - **A quarter of the pictures (11) were stills inside video players**, mostly of other reels waiting further down the feed; the same still turned up in the reports of two different reels. Pictures were chosen by file size alone, so they pushed out what was on screen. From 0.1.6 pictures on screen are checked first, and a still that sits under a video is named as one ("the still picture shown for a video on this page, not the video itself").
    - **The post's caption said "ai generated video", and the panel never mentioned it.** The caption is not next to any one picture or video, so the rule of item 4 did not apply. Nobody can tell from the page alone whether such words are the poster's caption or a viewer's comment, or which item they mean, so they must not decide a result. From 0.1.6, on one post's own page, they are shown as they are under **Written on this page**, with that caveat, and change nothing else (decision record 0014, amendment). The words of links are left out (they name another post or video); tags are kept.
    - What rightly did not count: a bare `#ai`, "Meta AI" (a product name), and an account name ending in ".ai".
    - The report's picture addresses carried the site's time-limited keys to each file, some for pictures from private messages. From 0.1.6 addresses are saved without what follows the "?".

**What this says about the measurements above:** the quiet check was estimated on long texts, not on real pages with their buttons and links, and that estimate was too kind. Two of the first three real pages were wrongly marked. The link fixes remove those two; real pages remain the thing to measure.

## Limits

- Chrome and Chromium browsers only; Firefox is not built.
- Pictures are downloaded a second time by the extension, without cookies. A site that only serves pictures to logged-in visitors gets "could not load this picture".
- Streamed video is checked only when the person asks and the video plays; protected (DRM) video cannot be read.
- Text and pictures inside embedded pages are not read (videos are).
- Detection limits are those of the core: see [EVAL.md](../../EVAL.md).
