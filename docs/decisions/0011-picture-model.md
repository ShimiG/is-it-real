# 0011: A pretrained picture model, measured and calibrated by us

**Status:** accepted (2026-11-11)

## Context

Provenance checks only work when an image carries a label or signature. Free generators often add none, and re-sharing strips what there was (docs/eval/m3-progress.md). Training our own image detector needs large, current data and GPUs this project does not have. Several pretrained detectors are published; their own reports are not independent.

## Decision

- Use a pretrained image classifier as a **measuring instrument** (ADR-0001): one number per image, turned into an outcome only by our calibration and rules.
- Choose it by **our own measurement** on images it was not trained on, made after it was trained, in three conditions (original, social copy, copy of a copy): docs/eval/m3-results.md. Chosen: `Thermostatic/community-forensics-low-quality-detector-2026-08` (MIT), float16 ONNX, 44 MB.
- **Calibrate on real photos, worst case:** each held-out real photo contributes its highest score over the three conditions, and _Likely made with AI_ needs a conformal score of at least 0.99. Calibration is computed with the exact shipped file (checked by sha256).
- **Weights are not redistributed.** Hosts download the file once from the author's pinned revision and verify its sha256 before use (`packages/core/src/image/models/`). This is the "one-time model download" allowed by ADR-0003; images never leave the computer.
- The picture model runs **only when the file and the site declare nothing**; a provenance declaration always wins.
- The preprocessing is our own TypeScript port, byte-identical to Pillow, so every host feeds the model the same input as the evaluation.

## Consequences

- Images with no label can now get _Likely made with AI_: on the test set about half to three quarters of new generators' originals, fewer after re-sharing, with about 0.5% of real test photos wrongly flagged.
- The guarantee covers photos like the calibration set (Open Images). Art, screenshots, memes and modern phone photos are not calibrated yet; measuring false alarms on them is the next step before the extension.
- The model is a third party's work and will age as generators change. The evaluation can be re-run on a new candidate in about an hour, and swapping models is a new description file plus a calibration run.

## Amendment (2026-11-11): the photo gate

Measuring false alarms on everyday images (docs/eval/m3-results.md) showed the model on its own wrongly flags about a third of human-made cartoons and digital art, and 7% of memes. So:

- **The picture model only judges plain photos.** A photo gate runs first: a general-purpose image encoder (CLIP ViT-B/32 image tower, MIT, 89 MB) plus a small logistic model trained in `eval/`. The encoder is a measuring instrument like the picture model (ADR-0001): it produces numbers, our trained rule decides. Images that do not pass get "not assessed" with the reason `not_a_photo`.
- **No gate, no picture check.** The core requires a gate to run the picture model; a host that cannot load the gate offers provenance checks only.
- **Calibration follows the gate:** the conformal calibration set is every non-AI calibration image that passes the gate, not stock photos only.
- **Accepted cost:** AI-made drawings, posters and memes without a label are not judged, and detection on originals fell from 75% / 53% / 62% to 63.5% / 24% / 39.5%, while false alarms fell from 84 to 6 of 1,065 non-AI test images. A lower false-alarm rate was preferred over catches that could not be told apart from false alarms (ADR-0006).
- Download size on first use grows by 176 MB (see the next amendment).

## Amendment 2 (2026-11-11): a model file must give the same numbers everywhere

The first gate used the quantized (8-bit) export of the encoder, 89 MB. A parity test written for the video check showed its output depends on the runtime's internal graph optimisations: the same picture gave embeddings with a cosine of only 0.993 between ONNX Runtime 1.29 (evaluation) and 1.31 (plugin), enough to move gate scores by up to 0.13. Measurements made with one runtime did not describe what users got with another.

- **Rule:** a model file is only shipped if the evaluation path and the shipped path give the same numbers on the same input, and a test checks it. Smaller is not a reason to accept a file that fails this.
- The gate now uses the float16 export of the same encoder (176 MB; cosine 0.9999997 across runtime settings). Gate 0.2.0 was retrained and the picture model recalibrated with it; the results moved by a point or two.
- The picture model itself already met the rule (float16 file; frame scores match between the two paths to four decimals).
