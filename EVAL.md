# Evaluation

What "Is It Real?" catches, what it misses, and how that was measured. Version: engine `0.8.0-m6`, plugin 0.5.0, browser extension 0.1.0 (2026-11-12).

Every number here can be reproduced: `pnpm eval:fetch` downloads the public datasets (pinned commits), `pnpm eval` prints the report. Details: [M1](docs/eval/m1-results.md), [M2](docs/eval/m2-results.md), [M3 labels](docs/eval/m3-progress.md), [M3 picture model](docs/eval/m3-results.md), [M5 video](docs/eval/m5-results.md), [M6 browser extension](docs/eval/m6-results.md).

## How to read the results

- The tool never says "real" or "human". Four outcomes: _Made with AI_, _Likely made with AI_, _No clear signs_, _Not checked_.
- _Likely made with AI_ is only shown at a strict setting: at most about 1 in 100 human texts of the kinds we calibrated on is flagged.
- Scam risk is shown first, because for most people the scam is the harm, not the AI.

## Scam warning signs (rules, no model)

| Test set                                                                 | Scams flagged | Normal messages flagged        |
| ------------------------------------------------------------------------ | ------------- | ------------------------------ |
| 40 scam / 40 look-alike messages, frozen in git before the rules existed | 40 of 40      | 1 of 40 (an awareness article) |
| 4,827 real everyday text messages (SMS Spam Collection)                  | n/a           | 0                              |

Limit: the scam messages were written for this project, by the same author as the rules. Real reported scam messages are the main missing piece.

## AI-written text

| Test                                                     | Result                                                                                 |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 2023 ChatGPT and Claude essays, news, stories (held-out) | 68% caught; 1 of 1,219 human texts wrongly flagged                                     |
| Non-native English writers (266 texts, four groups)      | **0 flagged** (commercial detectors flagged 61% of the TOEFL set in Liang et al. 2023) |
| Text from a current model (2026), 100 texts              | **13 of 100 caught**                                                                   |
| AI text rewritten by a "humanizer" tool                  | 40 of 100 caught                                                                       |
| A kind of text it was not calibrated on                  | False alarms rise to 2 to 4%                                                           |

Honest summary: useful against older or unedited AI text, weak against current models. It refuses texts under about 110 words and non-English text instead of guessing. The plugin uses the statistics-only version by default; the deeper check with a local language model is optional.

## AI images: labels and signatures

| Source                                          | What the file carries                                                                    | Result                                                                                                      |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| ChatGPT original                                | Signed by OpenAI, trusted                                                                | Made with AI                                                                                                |
| Gemini originals (2)                            | Signed by Google; AI claim in the image's signed history                                 | Made with AI                                                                                                |
| Copilot original                                | Signed by Microsoft; signature not fully up to the standard, image untouched             | Made with AI (with a note)                                                                                  |
| Lovable original (made with OpenAI's image API) | Signed by OpenAI; the API's certificate is not fully up to the standard, image untouched | Made with AI (with a note)                                                                                  |
| Meta AI original                                | Unsigned "made by AI" label                                                              | Made with AI                                                                                                |
| Perchance original (free, open-source models)   | Nothing                                                                                  | **No clear signs (miss)**                                                                                   |
| Gemini images pasted into a chat                | Nothing left after re-encoding                                                           | **No clear signs (miss)**                                                                                   |
| 26 official C2PA test images                    | Good, broken and unsigned                                                                | All classified as expected, except 3 that the current official library reports as broken (on the safe side) |

Two real-file bugs were found and fixed on the way (an AI claim hidden one step back in Google's history; Microsoft's non-standard signature treated as tampering).

Honest summary: original files from the big generators are recognised reliably. Re-shared copies and free generators usually carry nothing; for those, the picture model below helps when the picture is a plain photo.

## AI images: the picture model (no label needed)

A pretrained detector (MIT licence) that only judges **plain photos**. A second model, the photo gate, first decides whether a picture is a plain photo; drawings, paintings, screenshots and pictures with added text are **not checked**, because on those the detector cannot tell human work from AI (on its own it wrongly flagged a third of human-made cartoons and digital art). Measured on 600 AI images made **after** the detector was trained and 1,065 held-out non-AI images of eight kinds.

| Not AI: wrongly flagged                        | As published | Social-media copy | Copy of a copy |
| ---------------------------------------------- | ------------ | ----------------- | -------------- |
| All 1,065 non-AI images                        | 6 (0.6%)     | 0                 | 1              |
| of which stock, phone and stage photos (562)   | 4            | 0                 | 0              |
| of which cartoons, digital art, sketches (295) | 0            | 0                 | 0              |
| of which screenshots and memes (208)           | 2            | 0                 | 1              |

| AI: caught (and share not checked) | As published | Social-media copy | Copy of a copy |
| ---------------------------------- | ------------ | ----------------- | -------------- |
| GPT selfies and portraits          | 63.5% (8%)   | 19%               | 3.5%           |
| OpenAI gpt-image-2.5               | 24% (34%)    | 24%               | 12%            |
| Z-Image-Turbo (free open model)    | 39.5% (24%)  | 26.5%             | 17%            |

Honest summary: it catches a useful share of unlabelled AI photos as published, few after re-sharing, and it stays quiet on real pictures. AI-made drawings, posters and memes without a label are not judged at all. On the owner's real downloads it flags 2 of 5 re-shared Gemini copies; the Perchance anime image is "not checked". Details: [M3 picture model](docs/eval/m3-results.md).

## AI video (experimental)

Labels and signatures first, as for images. When a video carries none, six still frames go through the photo gate and the picture model, and the video is judged by their median against real videos. Measured on 426 AI and 185 real test videos, in three situations: the file itself, a re-shared copy (480 pixels high, recompressed), and a re-shared copy watched while it plays (what the browser extension sees on a video site).

| Not AI: wrongly flagged                            | The file itself | Re-shared file | Watched on a video site |
| -------------------------------------------------- | --------------- | -------------- | ----------------------- |
| 185 real videos (YouTube clips, studio recordings) | 2 (1.1%)        | 0              | 0                       |

| AI: _Made with AI_ or _Likely made with AI_                                      | The file itself | Re-shared file | Watched on a video site |
| -------------------------------------------------------------------------------- | --------------- | -------------- | ----------------------- |
| Current generators: Veo 3.1, Veo 3, Sora 2, Kling, Seedance 1 Pro, Wan 2.1 (157) | 61%             | 18%            | 14%                     |
| Older generators (160)                                                           | 54%             | 15%            | 5%                      |
| AI talking portraits (60)                                                        | 68%             | 20%            | 8%                      |
| Face swaps of real people (49)                                                   | **0%**          | **0%**         | **0%**                  |
| All 426 AI videos                                                                | 52%             | 15%            | 8%                      |

Of the 52%, 19 points come from signatures (every Sora, Sora 2 and Runway file carries one) and the rest from the frame check, which on its own catches 40% of files and leaves one video in four "not checked" (animated, stylised or captioned).

Honest summary: about half of AI video files are recognised, one in seven after re-sharing, one in twelve when watched on a video site, and real video is left alone. **Face-swap deepfakes are not caught at all, and a re-shared or streamed Sora 2 clip is not caught.** On video sites the site's own AI label is often the only thing that counts. A frame-to-frame motion check was tried and did not hold up. With 185 real videos the false-alarm rate for files could be as high as 4%. Details: [M5 video](docs/eval/m5-results.md).

## The browser extension

The extension runs the same core, so the numbers above apply to it, provided the browser hands the checks the same input. That was tested: Content Credentials read the same as in the plugin on every test file; pictures decode to the same pixels; the picture model and photo gate give the plugin's numbers (17 pictures, differences below 0.02 where the cut-off is 6.27); video frames too (84 frames, below 0.01). Two browser habits had to be undone to get there: browsers turn phone photos by their rotation note, and they colour video frames their own way.

Also measured: the side panel passes an automated WCAG audit in every state; all checks work with every outside host blocked; a page with twelve pictures takes 15 to 20 seconds on a four-core computer; the quiet background mark would appear on 0.7% of long human-written texts. Not done yet: a try-out with older users, real graphics cards (the model runs on the processor), Firefox. Details: [M6 browser extension](docs/eval/m6-results.md).

## Not measured yet

Video from phone cameras, screen recordings and video calls; real video sites' own re-encoding; lip-sync and face-swap checks; the scam rules on real web pages; the picture model on photos from current phones with heavy processing, and on Midjourney, Flux, Gemini and Grok output; text in languages other than English; current models from vendors other than the one used for the 2026 text set; real scam messages; the extension with real users.
