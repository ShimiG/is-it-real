"""Two side analyses for the video frame check, from the committed table
(eval/features/video-scores.v1.jsonl; numbers only, no clips needed). Results are quoted in
docs/eval/m5-results.md.

1. Other ways to combine the frame scores (mean, highest, ...) and other minimum frame counts,
   compared with the median that was chosen beforehand. Compared on the CALIBRATION half of the
   AI videos only, so the test half stays untouched.
2. Motion statistics (frame-to-frame differences, flicker, noise) as a detector: a logistic model,
   tested with whole sources held out. A detector that only works on sources it has seen has
   learned the collections (resolution, frame rate, compression), not AI video.

Usage: python3 -I eval/reference/video_analysis.py
"""

import collections
import json
import os

import numpy as np

TABLE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "features", "video-scores.v1.jsonl")
GATE = 0.5
rows = [json.loads(l) for l in open(TABLE) if l.startswith("{")]


def judged(r):
    return [l for l, g in zip(r["logit"], r["gate"]) if g >= GATE]


def at_least(n, f):
    return lambda j: float(f(j)) if len(j) >= n else None


AGGREGATES = {
    "median, 4+ frames (shipped)": at_least(4, np.median),
    "mean, 4+ frames": at_least(4, np.mean),
    "highest, 4+ frames": at_least(4, np.max),
    "2nd highest, 4+ frames": at_least(4, lambda j: sorted(j)[-2]),
    "lowest, 4+ frames": at_least(4, np.min),
    "median, 2+ frames": at_least(2, np.median),
    "median, 3+ frames": at_least(3, np.median),
    "median, all 6 frames": at_least(6, np.median),
}


def aggregates():
    print("1. Ways to combine frame scores (AI videos of the calibration half)\n")
    for name, f in AGGREGATES.items():
        worst = {}
        for r in rows:
            if r["truth"] == "real" and r["split"] == "calib":
                s = f(judged(r))
                if s is not None:
                    worst[r["id"]] = max(worst.get(r["id"], -1e9), s)
        cal = sorted(worst.values())
        out = collections.defaultdict(lambda: [0, 0, 0])
        for r in rows:
            if r["truth"] != "ai" or r["split"] != "calib":
                continue
            c = out[r["version"]]
            c[0] += 1
            s = f(judged(r))
            if s is None:
                c[2] += 1
            elif (1 + sum(x >= s for x in cal)) / (len(cal) + 1) <= 0.01:
                c[1] += 1
        a, b = out["original"], out["reshared"]
        print(f"  {name:28s} original {100 * a[1] / a[0]:5.1f}% (not checked {100 * a[2] / a[0]:.0f}%)   reshared {100 * b[1] / b[0]:5.1f}%")


KEYS = ["d1", "d2", "jerk", "still", "noise_q10", "noise_q25", "noise_q50", "flicker", "detail_change", "sharp"]


def features(r):
    bursts = [b for b in (r.get("motion") or []) if b and b.get("n", 0) >= 5]
    if not bursts:
        return None
    v = np.array([np.mean([b[k] for b in bursts]) for k in KEYS], float)
    ratios = [v[1] / (v[0] + 1e-6), v[7] / (v[0] + 1e-6), v[6] / (v[0] + 1e-6)]
    return np.log1p(np.abs(np.concatenate([v, ratios])))


def fit(X, y, l2=1.0, steps=300):
    """L2-regularised logistic regression by Newton steps on standardised features."""
    mu, sd = X.mean(0), X.std(0) + 1e-9
    Z = (X - mu) / sd
    w, b = np.zeros(Z.shape[1]), 0.0
    for _ in range(steps):
        p = 1 / (1 + np.exp(-(Z @ w + b)))
        W = p * (1 - p)
        H = (Z.T * W) @ Z / len(y) + l2 * np.eye(len(w)) / len(y)
        w -= np.linalg.solve(H, Z.T @ (p - y) / len(y) + l2 * w / len(y))
        b -= (p - y).mean() / (W.mean() + 1e-9)
    return lambda Xn: ((Xn - mu) / sd) @ w + b


def motion():
    data = [(r, features(r)) for r in rows]

    def xy(pred):
        chosen = [(f, 1.0 if r["truth"] == "ai" else 0.0) for r, f in data if f is not None and pred(r)]
        return np.array([f for f, _ in chosen]), np.array([t for _, t in chosen])

    print("\n2. Motion statistics as a detector (cut-off: 99th percentile of the non-AI training videos)\n")
    X, y = xy(lambda r: r["split"] == "calib")
    m = fit(X, y)
    cut = np.quantile(m(X[y == 0]), 0.99)
    Xt, yt = xy(lambda r: r["split"] == "test")
    s = m(Xt)
    print(f"  every source seen in training: non-AI flagged {100 * np.mean(s[yt == 0] > cut):.1f}%, AI caught {100 * np.mean(s[yt == 1] > cut):.1f}%")
    for held in ["msrvtt", "openvid", "dfd_real"]:
        X, y = xy(lambda r: r["source"] != held)
        m = fit(X, y)
        cut = np.quantile(m(X[y == 0]), 0.99)
        Xh, _ = xy(lambda r: r["source"] == held)
        print(f"  non-AI source {held} never seen: {100 * np.mean(m(Xh) > cut):.1f}% of its {len(Xh)} videos wrongly flagged")
    caught = total = 0
    for held in sorted({r["source"] for r in rows if r["truth"] == "ai"}):
        X, y = xy(lambda r: r["source"] != held and (r["truth"] == "ai" or r["split"] == "calib"))
        m = fit(X, y)
        cut = np.quantile(m(X[y == 0]), 0.99)
        Xh, _ = xy(lambda r: r["source"] == held)
        caught += int((m(Xh) > cut).sum())
        total += len(Xh)
    print(f"  each AI source never seen in turn: {100 * caught / total:.1f}% of {total} AI videos caught")


if __name__ == "__main__":
    aggregates()
    motion()
