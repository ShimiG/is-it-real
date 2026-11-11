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

### Real-world check: five Gemini images shared through a chat upload (2026-11-11)

The project owner shared five images generated with Gemini. They reached us through a chat upload, which re-encoded each one as WebP and kept only a colour profile.

|                                              | Result                                                                                                                             |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Content Credentials, XMP, generator settings | None left in any of the five files                                                                                                 |
| Outcome                                      | _No clear signs_ for all five (correct for what arrived; it is not a miss by the checks)                                           |
| Frequency features                           | Scattered inside the range of the 60 real photos, with no consistent pattern (5 images, and re-encoding blurs these traces anyway) |
| Image sizes                                  | Four of five have typical generator sizes: 1024x1024, 1408x768 (twice), 768x1376                                                   |
| Visible mark                                 | One image still shows Gemini's small sparkle logo in a corner                                                                      |

What this shows:

- **Re-sharing removes provenance.** Most of the AI images people will meet have passed through a chat app or social network that strips metadata, so provenance checks will often have nothing to read. This matches the research report and the first planning chat ("C2PA: high precision, low recall"). It is also why platform labels next to the image matter.
- **Google's invisible watermark (SynthID) probably survives this, but only Google can check it.** There is no open, offline detector. Pointing users to Google's own check would be an online lookup, which ADR-0003 rules out for now.
- **Two cheap ideas, not built:** a detector for visible generator logos (Gemini sparkle and similar) and "typical generator image size" as a weak supporting hint. Both need many more examples before they can be measured; one image is not evidence.

The five files are kept locally in `eval/datasets/.cache/private/` (git-ignored) and not committed: they depict real, identifiable people and a real company's branding.

### Real-world check: two ORIGINAL Gemini downloads (2026-11-11)

The owner then shared two files exactly as Gemini's download button saved them, through Google Drive (bytes unchanged). One is a PNG despite its `.jpeg` name.

|                             | File 1 (PNG, an image edited with Gemini)                                   | File 2 (JPEG, generated by Gemini)                                          |
| --------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Content Credentials         | Yes, signed by Google LLC ("Google Media Processing Services")              | Yes, same signer                                                            |
| Signature                   | Intact; signer not recognised in this check                                 | Intact and **trusted** (chains to the official C2PA list)                   |
| Manifests                   | 2: a 2025 Gemini edit, wrapped by a later Google "opened, transcoded" step  | 2: the Gemini generation, wrapped by the same kind of later step            |
| AI claim, in Google's words | "Added imperceptible SynthID watermark" (plus a visible watermark)          | "Created by Google Generative AI. Applied imperceptible SynthID watermark." |
| XMP                         | IPTC `compositeWithTrainedAlgorithmicMedia`, credit "Edited with Google AI" | none                                                                        |
| **Before the fix**          | Made with AI, but only because of the XMP                                   | **No clear signs: a miss**                                                  |
| **After the fix**           | Made with AI (signed history and XMP)                                       | **Made with AI** (signed, trusted history)                                  |

The miss: the newest manifest only says "opened, transcoded", and the AI claim is one step back in the history, which the summary did not read. Fixed by walking the validated history (ADR-0010 amendment). Real files found a bug that hand-made fixtures missed.

Open question: both files use the same Google certificate, yet one reports as trusted and the other as "signer not recognised". Not investigated yet.

The two files stay local (`eval/datasets/.cache/private/`, git-ignored); a local-only test checks them on every run where they exist.

### Real-world check: an ORIGINAL ChatGPT download (2026-11-11)

One PNG generated with ChatGPT, shared unchanged through Google Drive. Result: **Made with AI**, from a trusted signature, with no code changes.

|                       | ChatGPT                                                                                      | Gemini (for comparison)                                                   |
| --------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Signer                | OpenAI OpCo, LLC ("OpenAI Media Service"), **trusted**                                       | Google LLC, trusted on one file, not recognised on the other              |
| Where the AI claim is | In the newest manifest: `c2pa.created` by "ChatGPT" (`gpt-image`), `trainedAlgorithmicMedia` | One step back in the history, under a later "opened, transcoded" manifest |
| History               | None: a single manifest                                                                      | Two manifests                                                             |
| Invisible watermark   | Declared as `c2pa.watermarked.unbound` (OpenAI says it added one; its type is not named)     | Declared by name: "SynthID"                                               |
| XMP / IPTC metadata   | None                                                                                         | One of two files                                                          |
| File layout           | Manifest placed right after the PNG header, image data in one block                          | Manifest after the text chunks                                            |

Neither invisible watermark can be checked offline: only Google and OpenAI can read their own marks. Both companies do declare them in the signed manifest, and the evidence panel can say so.

### Real-world check: an ORIGINAL Copilot download (2026-11-11)

One PNG generated with Microsoft Copilot (Designer), shared unchanged through Google Drive.

|                                | Copilot                                                                                                                                                              |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Signer                         | Microsoft Corporation                                                                                                                                                |
| Validator says                 | Invalid: `signingCredential.invalid` ("certificate missing required EKU") and `claim.malformed` on the optional `c2pa.soft-binding` record. **No content mismatch.** |
| History                        | Two manifests: Microsoft Designer, with an "Azure OpenAI ImageGen" image placed in it as a component                                                                 |
| AI claim, in Microsoft's words | "Created image using artificial intelligence technology", "Generated with AI", "Content watermarked by Microsoft Responsible AI"                                     |
| **Before the fix**             | **No clear signs: a miss** (every failure was treated as tampering)                                                                                                  |
| **After the fix**              | **Made with AI**, with "the signature does not fully meet the standard, so we cannot confirm who signed it"                                                          |

Fix: validation failures are split into tampering (claims ignored) and signer conformance (claims count, never shown as a good signature). See ADR-0010, amendment 2.

**All seven real files so far:**

| File                                           | Signer state                                                       | Outcome        |
| ---------------------------------------------- | ------------------------------------------------------------------ | -------------- |
| ChatGPT original                               | trusted (OpenAI)                                                   | Made with AI   |
| Gemini original 2                              | trusted (Google), claim in history                                 | Made with AI   |
| Gemini original 1                              | intact, signer not recognised (Google), claim in history, plus XMP | Made with AI   |
| Copilot original                               | content intact, signer not up to the standard (Microsoft)          | Made with AI   |
| Meta AI original                               | **no Content Credentials**; unsigned IPTC label in XMP             | Made with AI   |
| Five Gemini images re-encoded by a chat upload | no manifest left                                                   | No clear signs |

Four generators, four different ways of labelling their images. Each original needed the checks to read it the way that company writes it. That is the main lesson: test against real files from every major generator, and keep doing so as they change.

### Real-world check: an ORIGINAL Meta AI download (2026-11-11)

One JPEG generated with Meta AI, shared unchanged through Google Drive. Result: **Made with AI**, no code changes, but from the weakest kind of evidence.

|                     | Meta AI                                                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Content Credentials | **None**                                                                                                                                                                       |
| What it has         | An XMP block (written with Exiv2) holding only the IPTC code `DigitalSourceType = trainedAlgorithmicMedia`, plus an IPTC IIM block with Facebook's `FBMD...` processing marker |
| Signed?             | No. Anyone can add or remove this label with a free metadata tool                                                                                                              |
| Shown reason        | "The file says it was generated by AI."                                                                                                                                        |

So of four major generators, three sign their images (Google, OpenAI, Microsoft) and one only labels them (Meta). The unsigned label still counts under ADR-0010 because people rarely label a real photo as AI, and the reason text says plainly that it is the file's own claim. Meta also says it adds an invisible watermark; as with Google and OpenAI, only Meta can check it.

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
2. Real-world AI images: Gemini, ChatGPT, Copilot and Meta AI originals confirm the path (above). Still worth adding: Adobe Firefly, Midjourney and Grok originals, and finding out why one Google signature reports as trusted and the other does not.
3. The C2PA reader for the browser (`@contentauth/c2pa-web`), needed in Phase 2.
4. Investigate the Truepic discrepancy.
