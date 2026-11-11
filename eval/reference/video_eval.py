"""Scores the video evaluation set and writes the video score table.

For every clip in eval/datasets/.cache/videos/manifest.jsonl, in two versions:
  original  the file as published
  reshared  re-encoded the way chat apps and social sites do: at most 480 px high, H.264 at CRF 30
it records, with numbers only:
  - 6 evenly spaced frames (frame k at (k + 0.5) / 6 of the duration), each scored exactly like a
    still image: photo-gate score (CLIP encoder + packages/core/src/image/photo-gate.model.json)
    and the picture model's raw logit (float32 copy of the shipped file, see image_eval.py)
  - simple motion statistics from two bursts of 9 consecutive frames (at 30% and 70%)
  - container facts (size, frame rate, duration), to check that results are not explained by them

Frames are decoded by ffmpeg, the same way the shipped Node code does it (packages/video-node).
Output: eval/features/video-scores.v1.jsonl. Resumable: clips already in the table are skipped.
Usage:  python3 -I eval/reference/video_eval.py [--limit N] [--wait-for N]
"""

import argparse
import io
import json
import os
import subprocess
import sys
import tempfile
import time

import numpy as np
import onnxruntime as ort
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import image_embed  # noqa: E402
import image_eval as ie  # noqa: E402

VIDEOS = os.path.join(ie.CACHE, "videos")
OUT = os.path.join(ie.HERE, "..", "features", "video-scores.v1.jsonl")
GATE_JSON = os.path.join(ie.HERE, "..", "..", "packages", "core", "src", "image", "photo-gate.model.json")
FRAMES = 6
BURST_AT = (0.3, 0.7)
BURST_FRAMES = 9
BURST_SIZE = 256


def run(cmd: list, timeout: int = 300) -> bytes:
    return subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=timeout, check=False).stdout


def probe(path: str) -> dict:
    out = run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,avg_frame_rate,codec_name:format=duration,bit_rate", "-of", "json", path])
    try:
        j = json.loads(out)
        s = j["streams"][0]
        num, den = (s.get("avg_frame_rate") or "0/1").split("/")
        return {
            "width": int(s["width"]),
            "height": int(s["height"]),
            "fps": round(float(num) / float(den), 3) if float(den) else 0.0,
            "duration": round(float(j["format"]["duration"]), 3),
            "kbps": round(float(j["format"].get("bit_rate") or 0) / 1000),
            "codec": s.get("codec_name", ""),
        }
    except Exception:
        return {}


def frame_at(path: str, t: float):
    """One decoded frame at time t (seconds), as an RGB image; None if ffmpeg gives nothing."""
    data = run(["ffmpeg", "-v", "error", "-ss", f"{t:.3f}", "-i", path, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "bmp", "-"])
    if not data:
        return None
    try:
        return Image.open(io.BytesIO(data)).convert("RGB")
    except Exception:
        return None


def burst(path: str, t: float):
    """BURST_FRAMES consecutive frames from time t, grey, BURST_SIZE square, as float32 [n, h, w]."""
    data = run(["ffmpeg", "-v", "error", "-ss", f"{t:.3f}", "-i", path, "-frames:v", str(BURST_FRAMES), "-vf", f"scale={BURST_SIZE}:{BURST_SIZE}:flags=area,format=gray", "-f", "rawvideo", "-"])
    n = len(data) // (BURST_SIZE * BURST_SIZE)
    if n < 3:
        return None
    return np.frombuffer(data[: n * BURST_SIZE * BURST_SIZE], np.uint8).reshape(n, BURST_SIZE, BURST_SIZE).astype(np.float32)


def laplacian(a: np.ndarray) -> np.ndarray:
    return 4 * a[..., 1:-1, 1:-1] - a[..., :-2, 1:-1] - a[..., 2:, 1:-1] - a[..., 1:-1, :-2] - a[..., 1:-1, 2:]


def motion_stats(f: np.ndarray) -> dict:
    """Simple statistics of how pixels change from frame to frame (grey levels 0..255)."""
    d = np.diff(f, axis=0)  # frame differences
    d1 = float(np.mean(np.abs(d)))
    d2 = float(np.mean(np.abs(np.diff(f, n=2, axis=0))))
    per_pixel_std = np.std(f, axis=0)
    luma = f.mean(axis=(1, 2))
    return {
        "n": int(f.shape[0]),
        "d1": round(d1, 4),  # how much the picture changes per frame
        "d2": round(d2, 4),  # how unevenly it changes
        "jerk": round(d2 / (d1 + 1e-3), 4),
        "still": round(float(np.mean(np.abs(d).mean(axis=(1, 2)) < 0.05)), 4),  # share of repeated frames
        "noise_q10": round(float(np.quantile(per_pixel_std, 0.10)), 4),  # change in the calmest areas
        "noise_q25": round(float(np.quantile(per_pixel_std, 0.25)), 4),
        "noise_q50": round(float(np.quantile(per_pixel_std, 0.50)), 4),
        "flicker": round(float(np.std(np.diff(luma, n=2))) if len(luma) >= 3 else 0.0, 4),  # brightness wobble
        "detail_change": round(float(np.mean(np.abs(laplacian(d))) / (np.mean(np.abs(laplacian(f))) + 1e-3)), 4),
        "sharp": round(float(np.mean(np.abs(laplacian(f)))), 4),
    }


class Scorer:
    def __init__(self):
        so = ort.SessionOptions()
        so.intra_op_num_threads = 4
        self.clf = ort.InferenceSession(os.path.join(ie.MODELS, ie.CANDIDATES["tf-low-quality"][0]), so, providers=["CPUExecutionProvider"])
        self.clip = ort.InferenceSession(image_embed.MODEL, so, providers=["CPUExecutionProvider"])
        g = json.load(open(GATE_JSON))["logistic"]
        self.g_mean, self.g_std = np.asarray(g["mean"]), np.asarray(g["std"])
        self.g_w, self.g_b = np.asarray(g["weights"]), g["bias"]

    def frame(self, im: Image.Image):
        e = self.clip.run(None, {self.clip.get_inputs()[0].name: image_embed.preprocess(im)})[0].reshape(-1).astype(np.float64)
        e /= np.linalg.norm(e) or 1.0
        z = float(self.g_b + np.sum(self.g_w * (e - self.g_mean) / np.where(self.g_std == 0, 1, self.g_std)))
        gate = 1 / (1 + np.exp(-z))
        _, mean, std = ie.CANDIDATES["tf-low-quality"]
        logit = float(self.clf.run(None, {self.clf.get_inputs()[0].name: ie.preprocess(im, mean, std)})[0].reshape(-1)[0])
        return round(float(gate), 4), round(logit, 4)


def score_file(scorer: Scorer, path: str) -> dict:
    info = probe(path)
    if not info or info["duration"] <= 0:
        return {"error": "unreadable"}
    gates, logits = [], []
    for k in range(FRAMES):
        im = frame_at(path, info["duration"] * (k + 0.5) / FRAMES)
        if im is None or min(im.size) < 16:
            continue
        g, l = scorer.frame(im)
        gates.append(g)
        logits.append(l)
    bursts = []
    for at in BURST_AT:
        f = burst(path, info["duration"] * at)
        if f is not None:
            bursts.append(motion_stats(f))
    return {**info, "gate": gates, "logit": logits, "motion": bursts}


def reshare(src: str, dst: str) -> bool:
    cmd = ["ffmpeg", "-v", "error", "-y", "-i", src, "-vf", "scale=-2:'min(480,ih)'", "-c:v", "libx264", "-crf", "30", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-an", dst]
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=900, check=False)
    return os.path.exists(dst) and os.path.getsize(dst) > 0


def manifest() -> list:
    path = os.path.join(VIDEOS, "manifest.jsonl")
    rows = [json.loads(line) for line in open(path) if line.strip()]
    # Mix the sources, so a partial table already covers all of them.
    return sorted(rows, key=lambda r: r["id"].split(":")[1])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--wait-for", type=int, default=0, help="keep re-reading the manifest until this many clips are scored")
    args = ap.parse_args()
    done = set()
    if os.path.exists(OUT):
        for line in open(OUT):
            if line.startswith("{"):
                r = json.loads(line)
                done.add((r["id"], r["version"]))
    scorer = Scorer()
    out = open(OUT, "a")
    count, t0 = 0, time.time()
    tmp = tempfile.mkdtemp(prefix="isitreal-video-")
    while True:
        todo = [r for r in manifest() if (r["id"], "reshared") not in done]
        for r in todo:
            src = os.path.join(VIDEOS, r["path"])
            base = {"id": r["id"], "source": r["source"], "truth": r["truth"], "split": r["split"]}
            if (r["id"], "original") not in done:
                out.write(json.dumps({**base, "version": "original", **score_file(scorer, src)}) + "\n")
                done.add((r["id"], "original"))
            copy = os.path.join(tmp, "reshared.mp4")
            res = score_file(scorer, copy) if reshare(src, copy) else {"error": "reencode failed"}
            out.write(json.dumps({**base, "version": "reshared", **res}) + "\n")
            out.flush()
            done.add((r["id"], "reshared"))
            if os.path.exists(copy):
                os.remove(copy)
            count += 1
            if count % 20 == 0:
                print(f"  {count} clips this run, {len(done) // 2} in table, {(time.time() - t0) / count:.1f} s per clip", file=sys.stderr, flush=True)
            if args.limit and count >= args.limit:
                break
        if (args.limit and count >= args.limit) or len(done) // 2 >= args.wait_for:
            break
        time.sleep(30)
    print(f"{len(done) // 2} clips in {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
