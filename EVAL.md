# Evaluation

What "Is It Real?" catches, what it misses, and how that was measured. Version: engine `0.4.0-m4`, plugin 0.1.0 (2026-11-11).

Every number here can be reproduced: `pnpm eval:fetch` downloads the public datasets (pinned commits), `pnpm eval` prints the report. Details: [M1](docs/eval/m1-results.md), [M2](docs/eval/m2-results.md), [M3](docs/eval/m3-progress.md).

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

Honest summary: original files from the big generators are recognised reliably. Re-shared copies and free generators usually carry nothing, and the statistical image check that would help there is not built yet (M3, in progress).

## Not measured yet

Video; images by statistics; text in languages other than English; current models from vendors other than the one used for the 2026 text set; real scam messages; speed in a browser extension.
