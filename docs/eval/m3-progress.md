# M3 progress: images

**Date:** 2026-11-10 · Engine `0.3.0-m3-partial` · Status: **provenance done; statistical image detection blocked on data** (see "Blocked").

## Done

### Provenance (what the file and the site say)

| Check                               | How                                                                                                                                       | Tested on                                                                |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Content Credentials (C2PA)          | Official library (`@contentauth/c2pa-node`), offline, validated against the bundled official C2PA trust list (33 certificate authorities) | 26 official public test images, plus signed, tampered and plain fixtures |
| File metadata                       | IPTC "made by AI" code inside XMP; settings left by Stable Diffusion, ComfyUI and InvokeAI                                                | Unit tests                                                               |
| Platform AI label next to the image | Short-string match per site (`platform-labels.ts`)                                                                                        | Unit tests; real-site check waits for the provenance census              |

Outcomes follow ADR-0010: a declaration of AI gives _Made with AI_; an intact signature without an AI claim, a broken signature, or nothing gives _No clear signs_.

**Conformance sweep** (c2pa-org/public-testfiles, legacy 1.4 JPEGs, commit `22beccc`):

|                                                                                                               | Files | Result                                                                          |
| ------------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------- |
| Good files reported intact                                                                                    | 13    | 13 of 13                                                                        |
| Deliberately broken files reported broken (bad signature, changed pixels, missing parts, expired certificate) | 8     | 8 of 8                                                                          |
| Files with no manifest                                                                                        | 2     | 2 of 2                                                                          |
| **Known discrepancy:** three 2023 Truepic photos listed as good                                               | 3     | Reported broken (`assertion.dataHash.mismatch`) by the current official library |

The discrepancy is on the safe side: those files get "the signature is broken or changed", never a wrong _Made with AI_. Cause not yet investigated (most likely stricter handling of old-format hashes in the current library).

**Tampering tests:** flipping 20 bytes of a signed AI-declared image changes the outcome from _Made with AI_ to _No clear signs_ with the broken-signature reason. A bug found on the way: the metadata scan read the AI code from inside the manifest, so a tampered file still counted; it now only reads XMP.

**Trust:** the public test certificate reports as "signer not recognised" against the official list, and as trusted when its root is added as an extra anchor.

### Page-level API

`checkPage({ text, pageHost, links, images, pageLabels }, { lm, c2pa })` returns scam risk first, then a verdict for the text, each image, and any page-level platform label. `checkImage` combines the file's provenance with a label shown next to it.

### Frequency analysis (groundwork only)

- A dependency-free FFT and 22 frequency features per image: the shape of the power spectrum, its slope, the share of high-frequency energy, the strongest isolated peak (upsampling traces), an 8-pixel grid measure (JPEG blocks), and the amount of fine detail. Computed on the central 256 x 256 pixels at native resolution.
- `@isitreal/image-node` decodes images with sharp.
- Unit tests confirm the math (impulse, cosine, energy conservation) and that the features respond to a planted periodic pattern, to blur and to an 8-pixel grid.
- **These features are not used in any verdict.** No model has been trained or calibrated on them.

### Sanity run on real photos

60 photos from Open Images (validation set): all 60 come out as _No clear signs_. Average per image: provenance 17 ms, decoding 17 ms, frequency features 70 ms (4-core cloud CPU, 0.76 megapixels on average).

## Blocked: statistical image detection

Training and measuring the frequency features, and adding a small image classifier, need two things this build environment cannot download:

| Needed                                                                                                            | Where it lives               | Status here                   |
| ----------------------------------------------------------------------------------------------------------------- | ---------------------------- | ----------------------------- |
| AI-generated images with matching real photos (for example Community Forensics, GenImage, Defactify, Synthbuster) | Hugging Face, Zenodo, Kaggle | Blocked by the network policy |
| A small pretrained image detector in ONNX format (for example the Community Forensics ViT)                        | Hugging Face                 | Blocked                       |

Real photos are reachable (Open Images), so the human side of a calibration set is not the problem. Nothing was mocked: no image statistical detector ships until it has been measured.

To unblock: allow `huggingface.co` (and its file hosts) and `zenodo.org` in the environment's network settings, or run the evaluation on a machine with normal internet access.

## Still to do in M3

1. Statistical image detection (blocked, above), then calibration and fusion with provenance.
2. Real-world signed AI images: a few files straight from generators that attach Content Credentials (for example ChatGPT image generation or Adobe Firefly), to confirm the _trusted and declares AI_ path on real output.
3. The C2PA reader for the browser (`@contentauth/c2pa-web`), needed in Phase 2.
4. Investigate the Truepic discrepancy.
