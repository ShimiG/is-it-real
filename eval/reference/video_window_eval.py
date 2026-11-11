"""How the video frame check behaves on a PLAYING video, the way the browser extension sees it.

The extension cannot seek a video the person is watching. It takes 6 frames about one second of
video apart, from wherever playback is. The main table (video_eval.py) takes 6 frames spread
over the whole clip. This script scores the "watching" way, so the two can be compared:

  - every non-AI clip, as the file is and as a re-shared copy (false alarms)
  - the AI clips of the test half, as a re-shared copy (video sites re-encode what is uploaded)

The start is fixed per clip (from a hash of its name), somewhere in the part of the clip that
leaves room for the window. Clips shorter than 6.5 seconds use a shorter step.
Output (numbers only): eval/features/video-window-scores.v1.jsonl, with the picture-model score
and the photo-gate score of each frame. Resumable.
Usage:  python3 -I eval/reference/video_window_eval.py [--shard K/N] [--threads T]
"""

import argparse
import hashlib
import json
import os
import sys
import tempfile

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import image_eval as ie  # noqa: E402
import video_eval as ve  # noqa: E402
import yuv  # noqa: E402

OUT = os.path.join(ie.HERE, "..", "features", "video-window-scores.v1.jsonl")
GATE = os.path.join(ie.HERE, "..", "..", "packages", "core", "src", "image", "photo-gate.model.json")
FRAMES = 6
STEP_S = 1.0


def gate_scorer():
    m = json.load(open(GATE))["logistic"]
    mean, std, w = (np.asarray(m[k], np.float64) for k in ("mean", "std", "weights"))
    std = np.where(std == 0, 1.0, std)
    return lambda emb: float(1 / (1 + np.exp(-(m["bias"] + np.dot(w, (np.asarray(emb, np.float64) - mean) / std)))))


def window_times(key: str, duration: float) -> list:
    step = min(STEP_S, duration / (FRAMES + 0.5))
    room = max(0.0, duration - step * FRAMES)
    start = room * (int(hashlib.sha256(("window:" + key).encode()).hexdigest()[:8], 16) / 0xFFFFFFFF)
    return [start + k * step for k in range(FRAMES)]


def score(scorer, gate, path: str, key: str) -> dict:
    info = ve.probe(path)
    if not info or info["duration"] <= 0:
        return {"error": "unreadable"}
    logits, gates = [], []
    for t in window_times(key, info["duration"]):
        im = yuv.frame_at(path, t)
        if im is None or min(im.size) < 16:
            continue
        emb, logit = scorer.frame(im)
        logits.append(logit)
        gates.append(round(gate(emb), 4))
    return {"duration": info["duration"], "logit": logits, "gate": gates}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--shard", default="")
    ap.add_argument("--threads", type=int, default=4)
    args = ap.parse_args()
    shard, shards = (int(x) for x in args.shard.split("/")) if args.shard else (0, 1)
    target = OUT if shards == 1 else OUT.replace(".jsonl", f".shard-{shard}.jsonl")
    done = set()
    folder = os.path.dirname(OUT)
    for name in os.listdir(folder):
        if name.startswith("video-window-scores.v1"):
            for line in open(os.path.join(folder, name)):
                if line.startswith("{"):
                    r = json.loads(line)
                    done.add((r["id"], r["version"]))
    scorer = ve.Scorer(args.threads)
    gate = gate_scorer()
    tmp = tempfile.mkdtemp(prefix="isitreal-window-")
    out = open(target, "a")
    if os.path.getsize(target) == 0 and shards == 1:
        out.write('// {"frames": 6, "step_seconds": 1.0, "gate": "image.photo-gate@0.2.0"}\n')
    count = 0
    for i, r in enumerate(ve.manifest()):
        if i % shards != shard:
            continue
        versions = ["original", "reshared"] if r["truth"] == "real" else (["reshared"] if r["split"] == "test" else [])
        src = os.path.join(ve.VIDEOS, r["path"])
        base = {"id": r["id"], "source": r["source"], "truth": r["truth"], "split": r["split"]}
        for version in versions:
            if (r["id"], version) in done:
                continue
            path = src
            if version == "reshared":
                path = os.path.join(tmp, "reshared.mp4")
                if os.path.exists(path):
                    os.remove(path)
                if not ve.reshare(src, path):
                    out.write(json.dumps({**base, "version": version, "error": "reencode failed"}) + "\n")
                    continue
            out.write(json.dumps({**base, "version": version, **score(scorer, gate, path, r["id"])}) + "\n")
            out.flush()
            count += 1
            if count % 50 == 0:
                print(f"  {count} clip versions this run", file=sys.stderr, flush=True)
    print(f"{count} clip versions written to {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
