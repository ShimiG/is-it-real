"""Scores the image evaluation set with each candidate classifier and writes the score table.

For every image in eval/datasets/.cache/images/manifest.jsonl and every view:
  original  the file as published
  social    long side at most 1080 px, JPEG quality 80   (a typical social-media / chat copy)
  harsh     long side at most 512 px, JPEG quality 60    (a copy of a copy)
it runs each available model (ONNX, CPU) and records the raw logit.

Preprocessing is the same as the TypeScript side (packages/core/src/image/preprocess.ts):
RGB, Pillow bicubic resize of the short edge to 440, centre crop 384, model-specific mean/std.

Output: eval/features/image-scores.v1.jsonl (numbers only; image ids, never pixels or URLs).
Usage:  python3 -I eval/reference/image_eval.py [--models a,b] [--limit N]
"""

import argparse
import io
import json
import os
import sys
import time

import numpy as np
import onnxruntime as ort
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "..", "datasets", ".cache")
IMAGES = os.path.join(CACHE, "images")
MODELS = os.path.join(CACHE, "models", "image")
OUT = os.path.join(HERE, "..", "features", "image-scores.v1.jsonl")

CLIP_MEAN, CLIP_STD = (0.48145466, 0.4578275, 0.40821073), (0.26862954, 0.26130258, 0.27577711)
IMAGENET_MEAN, IMAGENET_STD = (0.485, 0.456, 0.406), (0.229, 0.224, 0.225)

# name -> (file under models/image, mean, std). All: short edge 440, crop 384, one raw logit out.
CANDIDATES = {
    "cf-vit": ("cf-vit/model.onnx", CLIP_MEAN, CLIP_STD),
    "cf-vit-int8": ("cf-vit/model_int8.onnx", CLIP_MEAN, CLIP_STD),
    "tf-frontier": ("tf-frontier/model_fp16.onnx", IMAGENET_MEAN, IMAGENET_STD),
    "tf-low-quality": ("tf-low-quality/model_fp16.onnx", IMAGENET_MEAN, IMAGENET_STD),
}
VIEWS = {"original": None, "social": (1080, 80), "harsh": (512, 60)}


def make_view(im: Image.Image, view: str) -> Image.Image:
    spec = VIEWS[view]
    if spec is None:
        return im
    long_side, quality = spec
    w, h = im.size
    if max(w, h) > long_side:
        s = long_side / max(w, h)
        im = im.resize((max(1, round(w * s)), max(1, round(h * s))), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=quality, subsampling=2)
    return Image.open(io.BytesIO(buf.getvalue())).convert("RGB")


def preprocess(im: Image.Image, mean, std) -> np.ndarray:
    w, h = im.size
    rw, rh = (440, (440 * h) // w) if w <= h else ((440 * w) // h, 440)
    im = im.resize((rw, rh), Image.Resampling.BICUBIC)
    top, left = (rh - 384) // 2, (rw - 384) // 2
    a = np.asarray(im, dtype=np.float32)[top : top + 384, left : left + 384] * (1 / 255)
    a = (a - np.asarray(mean, np.float32)) / np.asarray(std, np.float32)
    return a.transpose(2, 0, 1)[None].astype(np.float32)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", default=",".join(CANDIDATES))
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()
    sessions = {}
    for name in args.models.split(","):
        path = os.path.join(MODELS, CANDIDATES[name][0])
        if not os.path.exists(path):
            print(f"skip {name}: {path} missing", file=sys.stderr)
            continue
        so = ort.SessionOptions()
        so.intra_op_num_threads = 4
        sessions[name] = ort.InferenceSession(path, so, providers=["CPUExecutionProvider"])
    if not sessions:
        print("no models available", file=sys.stderr)
        return 1
    rows = [json.loads(l) for l in open(os.path.join(IMAGES, "manifest.jsonl")) if l.strip()]
    if args.limit:
        rows = rows[: args.limit]
    out = []
    t0 = time.time()
    for i, r in enumerate(rows):
        try:
            base = Image.open(os.path.join(IMAGES, r["path"])).convert("RGB")
        except Exception as e:  # noqa: BLE001
            print(f"skip {r['id']}: {e}", file=sys.stderr)
            continue
        for view in VIEWS:
            im = make_view(base, view)
            scores = {}
            for name, sess in sessions.items():
                _, mean, std = CANDIDATES[name]
                x = preprocess(im, mean, std)
                (y,) = sess.run(None, {sess.get_inputs()[0].name: x})
                scores[name] = round(float(np.asarray(y).reshape(-1)[0]), 5)
            out.append({"id": r["id"], "source": r["source"], "truth": r["truth"], "split": r["split"], "view": view,
                        "width": base.size[0], "height": base.size[1], "scores": scores})
        if (i + 1) % 50 == 0:
            print(f"  {i + 1}/{len(rows)} images, {time.time() - t0:.0f}s", file=sys.stderr)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write("// " + json.dumps({"models": {n: CANDIDATES[n][0] for n in sessions}, "views": VIEWS}) + "\n")
        for row in out:
            f.write(json.dumps(row) + "\n")
    print(f"wrote {len(out)} rows -> {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
