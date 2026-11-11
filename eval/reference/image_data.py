"""Builds the image evaluation set in eval/datasets/.cache/images (git-ignored).

Sources (all fetched at evaluation time, never redistributed):

  real     Open Images V7 validation photos (Flickr, CC BY 2.0 per image), sampled deterministically.
           Not used to train any of the candidate detectors.
  gpt      winrisef/gpt-generated-image-collection (MIT), Sep-Nov 2026: photographic batches
           (portraits, selfies, family life), i.e. the "fake person" images scams use.
  gpt25    Isaacwang/blip3o-60k-gpt-image-2.5: OpenAI gpt-image-2.5 renders, October 2026.
  zimage   jiachengcui888/zimage-turbo-reference (Apache-2.0): Z-Image-Turbo, an open model, Oct 2026.

All AI sources post-date the candidate detectors' training (August 2026 or earlier).
Usage:  python3 -I eval/reference/image_data.py [--real N] [--per-source N] [--only real,gpt,...]
Writes  eval/datasets/.cache/images/manifest.jsonl  (id, path, truth, source, split, license)
"""

import argparse
import csv
import hashlib
import io
import json
import os
import sys
import tarfile
import urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "datasets", ".cache", "images")
HF = "https://huggingface.co/datasets"
OPEN_IMAGES_CSV = "https://storage.googleapis.com/openimages/2018_04/validation/validation-images-with-rotation.csv"
OPEN_IMAGES_URL = "https://open-images-dataset.s3.amazonaws.com/validation/{id}.jpg"

# Pinned dataset revisions (resolve/<revision>/...) for reproducibility.
REVISIONS = {
    "winrisef/gpt-generated-image-collection": "main",
    "Isaacwang/blip3o-60k-gpt-image-2.5": "main",
    "jiachengcui888/zimage-turbo-reference": "main",
}
GPT_BATCHES = ["0065", "0066", "0067", "0068", "0069"]  # selfies and travel/group photos (see the dataset card)


def rank(key: str) -> str:
    """Deterministic pseudo-random order."""
    return hashlib.sha256(key.encode()).hexdigest()


def split_of(key: str) -> str:
    """Half of each source calibrates, half tests. Only real photos are used for calibration."""
    return "calib" if int(rank("split:" + key)[:8], 16) % 2 == 0 else "test"


def get(url: str, timeout: int = 120) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "is-it-real-eval"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def save(rows: list, source: str, key: str, data: bytes, ext: str, truth: str, license_: str) -> None:
    d = os.path.join(ROOT, source)
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, f"{rank(key)[:16]}{ext}")
    with open(path, "wb") as f:
        f.write(data)
    rows.append(
        {
            "id": f"{source}:{rank(key)[:16]}",
            "path": os.path.relpath(path, ROOT),
            "truth": truth,
            "source": source,
            "split": split_of(key) if truth == "real" else "test",
            "license": license_,
            "origin": key,
        }
    )


def fetch_real(n: int, rows: list) -> None:
    text = get(OPEN_IMAGES_CSV).decode()
    ids = sorted((r["ImageID"] for r in csv.DictReader(io.StringIO(text))), key=rank)
    got = 0
    for image_id in ids:
        if got >= n:
            break
        try:
            data = get(OPEN_IMAGES_URL.format(id=image_id))
        except Exception as e:  # noqa: BLE001 - some files are gone; skip them
            print(f"  skip {image_id}: {e}", file=sys.stderr)
            continue
        save(rows, "real", image_id, data, ".jpg", "real", "CC BY 2.0 (Open Images; per-image attribution in the Open Images metadata)")
        got += 1
        if got % 50 == 0:
            print(f"  real {got}/{n}")


def fetch_gpt(n: int, rows: list) -> None:
    repo = "winrisef/gpt-generated-image-collection"
    entries = []
    for b in GPT_BATCHES:
        meta = get(f"{HF}/{repo}/resolve/{REVISIONS[repo]}/metadata/batch-{b}.jsonl").decode()
        entries += [json.loads(l)["image"] for l in meta.splitlines() if l.strip()]
    for rel in sorted(entries, key=rank)[:n]:
        save(rows, "gpt", rel, get(f"{HF}/{repo}/resolve/{REVISIONS[repo]}/{rel}"), ".png", "ai", "MIT")


def stream_tar(url: str, n: int, rows: list, source: str, license_: str) -> None:
    """Reads images from the start of a tar shard without downloading all of it."""
    req = urllib.request.Request(url, headers={"User-Agent": "is-it-real-eval"})
    got = 0
    with urllib.request.urlopen(req, timeout=600) as r, tarfile.open(fileobj=r, mode="r|*") as tar:
        for m in tar:
            if got >= n:
                break
            ext = os.path.splitext(m.name)[1].lower()
            if not m.isfile() or ext not in (".png", ".jpg", ".jpeg", ".webp"):
                continue
            save(rows, source, f"{url}#{m.name}", tar.extractfile(m).read(), ext, "ai", license_)
            got += 1


def fetch_tar_source(repo: str, prefix: str, source: str, n: int, rows: list, license_: str) -> None:
    api = json.loads(get(f"https://huggingface.co/api/datasets/{repo}"))
    shards = sorted(s["rfilename"] for s in api["siblings"] if s["rfilename"].startswith(prefix) and s["rfilename"].endswith(".tar"))
    per = max(1, n // min(len(shards), 4))
    for shard in shards[:4]:
        stream_tar(f"{HF}/{repo}/resolve/{REVISIONS[repo]}/{shard}", per, rows, source, license_)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--real", type=int, default=800)
    ap.add_argument("--per-source", type=int, default=200)
    ap.add_argument("--only", default="real,gpt,gpt25,zimage")
    args = ap.parse_args()
    only = set(args.only.split(","))
    os.makedirs(ROOT, exist_ok=True)
    manifest = os.path.join(ROOT, "manifest.jsonl")
    existing = []
    if os.path.exists(manifest):
        existing = [json.loads(l) for l in open(manifest) if l.strip()]
    rows = [r for r in existing if r["source"] not in only]
    jobs = {
        "real": lambda: fetch_real(args.real, rows),
        "gpt": lambda: fetch_gpt(args.per_source, rows),
        "gpt25": lambda: fetch_tar_source("Isaacwang/blip3o-60k-gpt-image-2.5", "gi25-blip3o-60k-20261023/dataset/", "gpt25", args.per_source, rows, "generator terms (OpenAI); evaluation only"),
        "zimage": lambda: fetch_tar_source("jiachengcui888/zimage-turbo-reference", "images/", "zimage", args.per_source, rows, "Apache-2.0"),
    }
    for name in [j for j in jobs if j in only]:
        before = len(rows)
        try:
            jobs[name]()
            print(f"{name}: {len(rows) - before} images")
        except Exception as e:  # noqa: BLE001
            print(f"{name}: FAILED ({e})", file=sys.stderr)
    with open(manifest, "w") as f:
        for r in sorted(rows, key=lambda r: r["id"]):
            f.write(json.dumps(r) + "\n")
    print(f"manifest: {len(rows)} rows -> {manifest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
