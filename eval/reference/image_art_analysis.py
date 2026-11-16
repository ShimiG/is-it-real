"""Could pictures that are NOT plain photos be judged against their own, higher cut-off?

The picture model is only used on plain photos (the photo gate keeps drawings, paintings,
screenshots and captioned pictures out), because on human-made art it gives false alarms. After a
report from real use (AI pictures in a painted style were "not checked" although the model scored
them very high), this measures the alternative: calibrate a second cut-off on human-made
non-photo pictures and judge non-photo pictures against that.

From the committed tables (numbers only): eval/features/image-scores.v1.jsonl and
image-gate.v1.jsonl. Results are quoted in docs/eval/m3-results.md.
Usage: python3 -I eval/reference/image_art_analysis.py
"""

import collections
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
FEATURES = os.path.join(HERE, "..", "features")
MODEL = "tf-low-quality"
GATE = 0.5

gate = {}
for line in open(os.path.join(FEATURES, "image-gate.v1.jsonl")):
    if line.startswith("{"):
        r = json.loads(line)
        gate[(r["id"], r["view"])] = r["gate"]
rows = [json.loads(line) for line in open(os.path.join(FEATURES, "image-scores.v1.jsonl")) if line.startswith("{")]
# Only picture versions the gate keeps out.
rows = [r for r in rows if gate.get((r["id"], r["view"]), 1.0) < GATE]


def calibration(sources=None):
    worst, kind = {}, {}
    for r in rows:
        if r["truth"] != "real" or r["split"] != "calib" or (sources and r["source"] not in sources):
            continue
        worst[r["id"]] = max(worst.get(r["id"], -99.0), r["scores"][MODEL])
        kind[r["id"]] = r["source"]
    return sorted(worst.values()), collections.Counter(kind.values())


def cut_off(values):
    n = len(values)
    k = int(0.01 * (n + 1)) - 1  # how many calibration pictures may be at or above a flagged number
    return values[n - 1 - k] if k >= 0 else float("inf")


def report(cut, title):
    cells = collections.defaultdict(lambda: [0, 0])
    for r in rows:
        if r["split"] != "test":
            continue
        for key in ((r["truth"], "all kinds", r["view"]), (r["truth"], r["source"], r["view"])):
            cells[key][0] += 1
            cells[key][1] += r["scores"][MODEL] > cut
    print(f"\n{title} (cut-off {cut:.2f}), test half, pictures the gate keeps out")
    for (truth, kind, view), (n, flagged) in sorted(cells.items()):
        if view == "original":
            print(f"  {'human-made' if truth == 'real' else 'AI':10s} {kind:12s} flagged {flagged:3d} of {n:3d} ({100 * flagged / n:.1f}%)")


pooled, mix = calibration()
print(f"calibration: {len(pooled)} human-made non-photo pictures ({dict(mix)})")
report(cut_off(pooled), "A. One cut-off from all human-made non-photo pictures")
art, _ = calibration({"digital_art"})
report(cut_off(art), f"B. A cut-off that protects digital paintings ({len(art)} of them)")
print("\nReading: A catches about a quarter of AI pictures but flags about 1 in 30 human digital")
print("paintings. B still flags about 1 in 45 human digital paintings and catches only 7% of AI")
print("pictures. At the top of the scale, human digital paintings and AI pictures score the same,")
print("so pictures of this kind are not judged.")
