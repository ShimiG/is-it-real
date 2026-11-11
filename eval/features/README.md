# Feature table

`text-features.v1.jsonl`: one row per evaluation text, numbers only (no text). Each row has the dataset, truth label, subgroup, split, word count, the 18 Tier 0 statistics (`t0`) and the 11 language-model features (`lm`, null when the text is too short or not English). The first line records the model and settings.

`pnpm eval` and `pnpm --filter @isitreal/eval run train:text` read this file, so results reproduce without the 665 MB model or the source texts.

To rebuild it (about 35 minutes on 4 cores):

```bash
pnpm eval:fetch --full
```

```bash
for i in 0 1 2 3; do pnpm --filter @isitreal/eval run features --shard $i/4 & done; wait
```

```bash
pnpm --filter @isitreal/eval run features --merge
```

`pnpm eval:fetch --full` downloads the datasets (about 2 GB) into `eval/datasets/.cache`. The GPT-2 model file (`gpt2-lm-head-10.onnx`, see `GPT2_ZOO` in `packages/lm-node`) goes in `eval/datasets/.cache/models/gpt2/`.

## Image and video tables

`image-scores.v1.jsonl` and `image-gate.v1.jsonl`: the picture-model score and the photo-gate score of every evaluation image in three versions (see `docs/eval/m3-results.md`).

`video-scores.v1.jsonl`: one row per evaluation clip and version (as the file is, re-shared copy): size, frame rate, the picture-model score and photo-gate score of six frames, and motion statistics from two short bursts of frames. Written by `eval/reference/video_eval.py` and `pnpm --filter @isitreal/eval run gate:train`; read by `pnpm eval`, `pnpm --filter @isitreal/eval run write:video-model` and `eval/reference/video_analysis.py` (see `docs/eval/m5-results.md`).
