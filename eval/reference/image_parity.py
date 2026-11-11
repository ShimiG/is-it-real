"""Writes Pillow reference outputs for the TypeScript preprocessing parity test.

For a few real photos: Pillow-decoded RGB, and Pillow's bicubic resize to a short edge of 440,
as raw bytes, plus an index. packages/core/test/preprocess-parity.test.ts compares its own resize
of the same decoded pixels against Pillow's, byte by byte.

Usage: python3 -I eval/reference/image_parity.py [N]
"""

import json
import os
import sys

from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "datasets", ".cache")
OUT = os.path.join(ROOT, "parity-images")


def short_edge_size(w: int, h: int, short: int) -> tuple:
    return (short, (short * h) // w) if w <= h else ((short * w) // h, short)


def main() -> int:
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 6
    os.makedirs(OUT, exist_ok=True)
    real_dir = os.path.join(ROOT, "images", "real")
    rows = [{"id": "real:" + f.split(".")[0], "path": os.path.join("real", f)} for f in sorted(os.listdir(real_dir))]
    cases = []
    for r in rows[:n]:
        im = Image.open(os.path.join(ROOT, "images", r["path"])).convert("RGB")
        w, h = im.size
        rw, rh = short_edge_size(w, h, 440)
        resized = im.resize((rw, rh), Image.Resampling.BICUBIC)
        base = r["id"].replace(":", "_")
        open(os.path.join(OUT, base + ".src.rgb"), "wb").write(im.tobytes())
        open(os.path.join(OUT, base + ".pil440.rgb"), "wb").write(resized.tobytes())
        cases.append({"id": r["id"], "path": r["path"], "width": w, "height": h, "outWidth": rw, "outHeight": rh, "base": base})
    json.dump(cases, open(os.path.join(OUT, "index.json"), "w"), indent=1)
    print(f"wrote {len(cases)} cases to {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
