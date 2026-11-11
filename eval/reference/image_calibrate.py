"""Calibration scores for the shipped image classifier, computed with the exact shipped file.

For every REAL photo in the calibration split, scores the original, social and harsh views with
the model and keeps the HIGHEST of the three logits: an image is judged once without knowing its
condition, so calibrating on the worst case keeps false alarms at or below alpha in every condition.
Output: one score per image id; write-image-model.ts picks the images that pass the photo gate
and writes the sorted list into the core's model description.

Usage: python3 -I eval/reference/image_calibrate.py <model.onnx> <imagenet|clip> <out.json> [sources, comma-separated]
"""

import hashlib
import json
import os
import sys

import onnxruntime as ort
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import image_eval as ie  # noqa: E402


def main() -> int:
    model, preset, out = sys.argv[1], sys.argv[2], sys.argv[3]
    sources = set(sys.argv[4].split(",")) if len(sys.argv) > 4 else {"real"}
    mean, std = (ie.IMAGENET_MEAN, ie.IMAGENET_STD) if preset == "imagenet" else (ie.CLIP_MEAN, ie.CLIP_STD)
    so = ort.SessionOptions()
    so.intra_op_num_threads = 4
    sess = ort.InferenceSession(model, so, providers=["CPUExecutionProvider"])
    name = sess.get_inputs()[0].name
    rows = [json.loads(l) for l in open(os.path.join(ie.IMAGES, "manifest.jsonl")) if l.strip()]
    calib = [r for r in rows if r["truth"] == "real" and r["split"] == "calib" and r["source"] in sources]
    # Resume: keep scores already computed for other images.
    by_id = {}
    if os.path.exists(out):
        by_id = json.load(open(out)).get("byId", {})
    digest = hashlib.sha256(open(model, "rb").read()).hexdigest()
    for i, r in enumerate(calib):
        if r["id"] in by_id:
            continue
        base = Image.open(os.path.join(ie.IMAGES, r["path"])).convert("RGB")
        best = max(
            float(sess.run(None, {name: ie.preprocess(ie.make_view(base, v), mean, std)})[0].reshape(-1)[0]) for v in ie.VIEWS
        )
        by_id[r["id"]] = round(best, 5)
        if (i + 1) % 50 == 0:
            print(f"  {i + 1}/{len(calib)}", file=sys.stderr)
            json.dump({"model": os.path.basename(model), "sha256": digest, "byId": by_id}, open(out, "w"))
    json.dump({"model": os.path.basename(model), "sha256": digest, "byId": by_id}, open(out, "w"))
    print(f"wrote {len(by_id)} calibration scores (per image id) -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
