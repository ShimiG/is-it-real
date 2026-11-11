"""Calibration scores for the shipped image classifier, computed with the exact shipped file.

For every REAL photo in the calibration split, scores the original, social and harsh views with
the model and keeps the HIGHEST of the three logits: an image is judged once without knowing its
condition, so calibrating on the worst case keeps false alarms at or below alpha in every condition.
Output: one score per image id; write-image-model.ts picks the images that pass the photo gate
and writes the sorted list into the core's model description.

Usage: python3 -I eval/reference/image_calibrate.py <model.onnx> <imagenet|clip> <out.json> [sources, comma-separated] [minimum score-table value] [photo-gate threshold]
"""

import hashlib
import json
import os
import sys

import onnxruntime as ort
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import image_eval as ie  # noqa: E402

HERE_FEATURES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "features")


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
    # Only the highest-scoring images decide where the 1% cut-off falls. With a minimum given,
    # only images whose score-table value (float32 copy of the model) reaches it are rescored with
    # the exact file; the rest keep their score-table value (the two differ by at most ~0.07).
    minimum = float(sys.argv[5]) if len(sys.argv) > 5 else None
    if minimum is not None:
        best = {}
        key = "tf-low-quality"
        for line in open(os.path.join(HERE_FEATURES, "image-scores.v1.jsonl")):
            if line.startswith("{"):
                t = json.loads(line)
                if key in t["scores"]:
                    best[t["id"]] = max(best.get(t["id"], -1e9), t["scores"][key])
        calib = [r for r in calib if best.get(r["id"], 1e9) >= minimum]
        print(f"rescoring {len(calib)} images with score-table value >= {minimum}", file=sys.stderr)
    # With a photo-gate threshold given, only images the gate lets through in at least one version
    # are rescored: the others are never judged by the model, so they are not calibration images.
    if len(sys.argv) > 6:
        threshold = float(sys.argv[6])
        passes = set()
        for line in open(os.path.join(HERE_FEATURES, "image-gate.v1.jsonl")):
            if line.startswith("{"):
                t = json.loads(line)
                if t["gate"] >= threshold:
                    passes.add(t["id"])
        calib = [r for r in calib if r["id"] in passes]
        print(f"of those, {len(calib)} pass the photo gate at {threshold}", file=sys.stderr)
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
