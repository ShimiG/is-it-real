"""Builds the video evaluation set in eval/datasets/.cache/videos (git-ignored).

Everything is fetched at evaluation time and never redistributed. Large archives are read with
HTTP range requests, so only the chosen clips are downloaded.

Not AI
  msrvtt     friedrichor/MSR-VTT: YouTube clips collected in 2016 (320x240), before video generators
  openvid    nkp37/OpenVid-1M (CC-BY-4.0): YouTube clips in HD, collected 2024 from older uploads
  dfd_real   angads24/deepfake-video (CC-BY-SA-4.0), folder real: the actors' original recordings
             from Google's DeepFakeDetection set (2019)

AI: text-to-video (whole frame generated)
  veo3, veo2, seedance, wan21, ray2, pika22, runway, hunyuan, sora1, mochi
             Rapidata/text-2-video-human-preferences-seedance-1-pro (Apache-2.0), one folder per model
  veo31      Rapidata/text-2-video-human-preferences-veo3.1 (Apache-2.0)
  sora2      34data/gen-videos-sora2 (no licence stated; evaluation only), July 2026
  kling      34data/gen-videos-kling (no licence stated; evaluation only), July 2026
  portrait   NetherlandsForensicInstitute/synthetic-portrait-videos (CC-BY-SA-4.0), 2026: talking
             portraits from Kling, Luma, Pika, PixVerse, Runway and Sora

AI: face swap (a real recording with the face replaced)
  dfd_fake   angads24/deepfake-video (CC-BY-SA-4.0), folder fake: Google DeepFakeDetection (2019)

Every source is split half "calib", half "test" by a hash of the file name. Non-AI calib clips set
the false-alarm threshold; AI calib clips are a development set for choosing between rules; all
reported numbers come from the test half.

Usage:  python3 -I eval/reference/video_data.py [--only a,b] [--scale 1.0]
Writes  eval/datasets/.cache/videos/manifest.jsonl
"""

import argparse
import json
import os
import sys
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from image_data import HF, get, rank, split_of  # noqa: E402
from image_everyday import HttpRangeFile  # noqa: E402

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "datasets", ".cache", "videos")
MAX_BYTES = 60 * 1024 * 1024
RAPIDATA = "Rapidata/text-2-video-human-preferences-seedance-1-pro"

# source -> (kind, repo, where, truth, how many, licence)
SOURCES = {
    "msrvtt": ("zip", "friedrichor/MSR-VTT", "MSRVTT_Videos.zip", "real", 120, "MSR-VTT terms; evaluation only"),
    "openvid": ("zip", "nkp37/OpenVid-1M", "OpenVid_part100.zip", "real", 150, "CC-BY-4.0"),
    "dfd_real": ("dir", "angads24/deepfake-video", "dataset/real/", "real", 100, "CC-BY-SA-4.0"),
    "veo3": ("dir", RAPIDATA, "Videos/veo3/", "ai", 50, "Apache-2.0"),
    "veo2": ("dir", RAPIDATA, "Videos/veo2/", "ai", 50, "Apache-2.0"),
    "seedance": ("dir", RAPIDATA, "Videos/seedance-1-pro-24-7-25/", "ai", 50, "Apache-2.0"),
    "wan21": ("dir", RAPIDATA, "Videos/wan2.1/", "ai", 50, "Apache-2.0"),
    "ray2": ("dir", RAPIDATA, "Videos/ray2/", "ai", 50, "Apache-2.0"),
    "pika22": ("dir", RAPIDATA, "Videos/pika2.2/", "ai", 50, "Apache-2.0"),
    "runway": ("dir", RAPIDATA, "Videos/alpha/", "ai", 50, "Apache-2.0"),
    "hunyuan": ("dir", RAPIDATA, "Videos/hunyuan/", "ai", 50, "Apache-2.0"),
    "sora1": ("dir", RAPIDATA, "Videos/sora/", "ai", 50, "Apache-2.0"),
    "mochi": ("dir", RAPIDATA, "Videos/mochi-1-24-7-25/", "ai", 50, "Apache-2.0"),
    "veo31": ("dir", "Rapidata/text-2-video-human-preferences-veo3.1", "videos/", "ai", 50, "Apache-2.0"),
    "sora2": ("zip", "34data/gen-videos-sora2", "data_001.zip", "ai", 50, "none stated; evaluation only"),
    "kling": ("zip", "34data/gen-videos-kling", "data_001.zip", "ai", 50, "none stated; evaluation only"),
    "portrait": ("dir", "NetherlandsForensicInstitute/synthetic-portrait-videos", "fake/", "ai", 127, "CC-BY-SA-4.0"),
    "dfd_fake": ("dir", "angads24/deepfake-video", "dataset/fake/", "ai", 100, "CC-BY-SA-4.0"),
}


def load_manifest() -> list:
    path = os.path.join(ROOT, "manifest.jsonl")
    if not os.path.exists(path):
        return []
    return [json.loads(line) for line in open(path) if line.strip()]


def write_manifest(rows: list) -> None:
    os.makedirs(ROOT, exist_ok=True)
    rows.sort(key=lambda r: r["id"])
    with open(os.path.join(ROOT, "manifest.jsonl"), "w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")


def add(rows: list, have: set, source: str, key: str, truth: str, license_: str, read) -> None:
    """Saves one clip unless it is already there. `read` returns the bytes."""
    vid = f"{source}:{rank(key)[:16]}"
    if vid in have:
        return
    d = os.path.join(ROOT, source)
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, f"{rank(key)[:16]}.mp4")
    data = read()
    with open(path, "wb") as f:
        f.write(data)
    rows.append(
        {
            "id": vid,
            "path": os.path.relpath(path, ROOT),
            "truth": truth,
            "source": source,
            "split": split_of(key),
            "license": license_,
            "origin": key,
            "bytes": len(data),
        }
    )
    have.add(vid)
    write_manifest(rows)


def fetch(source: str, rows: list, scale: float) -> None:
    kind, repo, where, truth, n, license_ = SOURCES[source]
    n = max(1, round(n * scale))
    have = {r["id"] for r in rows}
    if kind == "dir":
        files = json.loads(get(f"https://huggingface.co/api/datasets/{repo}?blobs=true"))["siblings"]
        names = sorted(
            (f["rfilename"] for f in files if f["rfilename"].startswith(where) and f["rfilename"].lower().endswith(".mp4") and (f.get("size") or 0) <= MAX_BYTES),
            key=lambda name: rank(f"{repo}/{name}"),
        )[:n]
        for i, name in enumerate(names):
            add(rows, have, source, f"{repo}/{name}", truth, license_, lambda name=name: get(f"{HF}/{repo}/resolve/main/{name}", 600))
            if (i + 1) % 25 == 0:
                print(f"  {source}: {i + 1}/{len(names)}", file=sys.stderr)
    else:
        z = zipfile.ZipFile(HttpRangeFile(f"{HF}/{repo}/resolve/main/{where}"))
        infos = sorted(
            (i for i in z.infolist() if i.filename.lower().endswith(".mp4") and 0 < i.file_size <= MAX_BYTES),
            key=lambda i: rank(f"{repo}/{where}/{i.filename}"),
        )[:n]
        # Read in file order: neighbouring clips share downloaded blocks.
        for k, i in enumerate(sorted(infos, key=lambda i: i.header_offset)):
            add(rows, have, source, f"{repo}/{where}/{i.filename}", truth, license_, lambda i=i: z.read(i))
            if (k + 1) % 25 == 0:
                print(f"  {source}: {k + 1}/{len(infos)}", file=sys.stderr)
    print(f"{source}: {sum(1 for r in rows if r['source'] == source)} clips", file=sys.stderr)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default=",".join(SOURCES))
    ap.add_argument("--scale", type=float, default=1.0, help="multiply every source's clip count")
    args = ap.parse_args()
    rows = load_manifest()
    for source in args.only.split(","):
        try:
            fetch(source, rows, args.scale)
        except Exception as e:  # keep going: one unreachable source must not lose the others
            print(f"{source}: FAILED {e!r}", file=sys.stderr)
    write_manifest(rows)
    print(f"{len(rows)} clips in {ROOT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
