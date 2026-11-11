# Decision records

Short records of the main design decisions (format: context, decision, consequences). New decisions get the next number; superseded ones stay, marked as such.

| #                                                   | Decision                                                            | Status   |
| --------------------------------------------------- | ------------------------------------------------------------------- | -------- |
| [0001](0001-algorithms-decide-llms-explain.md)      | Algorithms decide, LLMs only explain                                | Accepted |
| [0002](0002-four-outcomes-never-human.md)           | Four outcome levels; never say "Human"                              | Accepted |
| [0003](0003-offline-only.md)                        | Offline only; no bring-your-own-key cloud APIs                      | Accepted |
| [0004](0004-typescript-onnx-core.md)                | One TypeScript/ONNX core; Python only for evaluation parity         | Accepted |
| [0005](0005-plugin-first.md)                        | Claude plugin first, extension after the M5 gate                    | Accepted |
| [0006](0006-conformal-thresholds.md)                | Conformal thresholds at ≤ 1% false positives on human content       | Accepted |
| [0007](0007-scam-risk-first.md)                     | Scam risk is shown before AI signals                                | Accepted |
| [0008](0008-dom-first-and-video-capture.md)         | Read the DOM first; video capture strategy per host                 | Accepted |
| [0009](0009-language-model-as-probability-meter.md) | A small local language model as a probability meter (GPT-2 for now) | Accepted |
| [0010](0010-image-provenance-declarations.md)       | Which image provenance claims count as "Made with AI"               | Accepted |
| [0011](0011-picture-model.md)                       | A pretrained picture model, measured and calibrated by us           | Accepted |
| [0012](0012-video-frame-check.md)                   | Video: labels first, then an experimental frame check               | Accepted |
| [0013](0013-extension-architecture.md)              | How the browser extension is built                                  | Accepted |
