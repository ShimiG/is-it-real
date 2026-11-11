"""Embeds every evaluation image with the CLIP ViT-B/32 image encoder (float16 ONNX, MIT) in
the same three versions as the picture-model scores. The embeddings feed the "photo or drawing?"
gate (eval/src/image-gate-train.ts). Output: eval/datasets/.cache/clip-embeds.jsonl (large; the
gate training reads it, and only the small trained gate is committed).

Preprocessing: RGB, Pillow bicubic resize of the short edge to 224, centre crop 224, CLIP mean/std
(the same pipeline as packages/core/src/image/preprocess.ts with resizeShortEdge 224, cropSize 224).

Why float16 and not the smaller quantized file: the quantized encoder's output changes with the
runtime's internal graph optimisations (cosine 0.993 between ONNX Runtime 1.29 and 1.31 on the same
input), which moved gate scores by up to 0.13. The float16 file gives the same numbers everywhere
(cosine 0.9999997 across settings).

Usage: python3 -I eval/reference/image_embed.py [--views original,social,harsh]
"""

import argparse
import json
import os
import sys
import time

import numpy as np
import onnxruntime as ort
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import image_eval as ie  # noqa: E402

MODEL = os.path.join(ie.MODELS, "clip-b32", "vision_model_fp16.onnx")
OUT = os.path.join(ie.CACHE, "clip-embeds.jsonl")


def preprocess(im: Image.Image) -> np.ndarray:
    w, h = im.size
    rw, rh = (224, (224 * h) // w) if w <= h else ((224 * w) // h, 224)
    im = im.resize((rw, rh), Image.Resampling.BICUBIC)
    top, left = (rh - 224) // 2, (rw - 224) // 2
    a = np.asarray(im, dtype=np.float32)[top : top + 224, left : left + 224] * (1 / 255)
    a = (a - np.asarray(ie.CLIP_MEAN, np.float32)) / np.asarray(ie.CLIP_STD, np.float32)
    return a.transpose(2, 0, 1)[None].astype(np.float32)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--views", default="original,social,harsh")
    args = ap.parse_args()
    so = ort.SessionOptions()
    so.intra_op_num_threads = 2
    sess = ort.InferenceSession(MODEL, so, providers=["CPUExecutionProvider"])
    rows = [json.loads(l) for l in open(os.path.join(ie.IMAGES, "manifest.jsonl")) if l.strip()]
    t0 = time.time()
    with open(OUT, "w") as f:
        for i, r in enumerate(rows):
            try:
                base = Image.open(os.path.join(ie.IMAGES, r["path"])).convert("RGB")
            except Exception as e:  # noqa: BLE001
                print(f"skip {r['id']}: {e}", file=sys.stderr)
                continue
            for view in args.views.split(","):
                (e,) = sess.run(["image_embeds"], {"pixel_values": preprocess(ie.make_view(base, view))})
                e = e.reshape(-1)
                e = e / np.linalg.norm(e)
                f.write(json.dumps({"id": r["id"], "source": r["source"], "truth": r["truth"], "split": r["split"], "view": view, "e": [round(float(x), 5) for x in e]}) + "\n")
            if (i + 1) % 200 == 0:
                print(f"  {i + 1}/{len(rows)} images, {time.time() - t0:.0f}s", file=sys.stderr, flush=True)
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
