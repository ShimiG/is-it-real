"""Calibration scores for the shipped image classifier, computed with the exact shipped file.

For every REAL photo in the calibration split, scores the original, social and harsh views with
the model and keeps the HIGHEST of the three logits: an image is judged once without knowing its
condition, so calibrating on the worst case keeps false alarms at or below alpha in every condition.
Output: the sorted list, written into the core's model description.

Usage: python3 -I eval/reference/image_calibrate.py <model.onnx> <mean,std preset: imagenet|clip> <out.json>
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
    mean, std = (ie.IMAGENET_MEAN, ie.IMAGENET_STD) if preset == "imagenet" else (ie.CLIP_MEAN, ie.CLIP_STD)
    so = ort.SessionOptions()
    so.intra_op_num_threads = 4
    sess = ort.InferenceSession(model, so, providers=["CPUExecutionProvider"])
    name = sess.get_inputs()[0].name
    rows = [json.loads(l) for l in open(os.path.join(ie.IMAGES, "manifest.jsonl")) if l.strip()]
    calib = [r for r in rows if r["truth"] == "real" and r["split"] == "calib"]
    scores = []
    for i, r in enumerate(calib):
        base = Image.open(os.path.join(ie.IMAGES, r["path"])).convert("RGB")
        best = max(
            float(sess.run(None, {name: ie.preprocess(ie.make_view(base, v), mean, std)})[0].reshape(-1)[0]) for v in ie.VIEWS
        )
        scores.append(round(best, 5))
        if (i + 1) % 50 == 0:
            print(f"  {i + 1}/{len(calib)}", file=sys.stderr)
    digest = hashlib.sha256(open(model, "rb").read()).hexdigest()
    json.dump({"model": os.path.basename(model), "sha256": digest, "n": len(scores), "calibration": sorted(scores)}, open(out, "w"))
    print(f"wrote {len(scores)} calibration scores -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
