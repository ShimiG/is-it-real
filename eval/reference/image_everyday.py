"""Adds everyday NON-AI images to the image evaluation set, to measure false alarms beyond
stock-style photos. Everything is fetched at evaluation time and never redistributed.

  phone        SPAQ: photos taken with 66 smartphone models (Fang et al., CVPR 2020), via
               chaofengc/IQA-PyTorch-Datasets (spaq.tgz, streamed from the start)
  screenshot   OS-Copilot/ScreenSpot-v2 (Apache-2.0): phone, desktop and web screenshots
  meme         neuralcatcher/hateful_memes: photo-plus-caption memes (Facebook AI, 2020, before
               image generators were common)
  cartoon, digital_art, sketch, cosplay
               suxi123/Human-Art (CVPR 2023, collected in 2022): human-made art and stage photos.
               digital_art may contain a few early AI images; treated as human-made here.

Each source is split half calibration, half test (same rule as the real photos).
Usage:  python3 -I eval/reference/image_everyday.py [--per-source N] [--only a,b]
"""

import argparse
import io
import json
import os
import sys
import tarfile
import urllib.request
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from image_data import HF, ROOT, get, rank, save  # noqa: E402

IMAGE_EXT = (".jpg", ".jpeg", ".png", ".webp")


class HttpRangeFile(io.RawIOBase):
    """Read-only, seekable view of a remote file using HTTP Range requests (for zipfile)."""

    def __init__(self, url: str, block: int = 4 * 1024 * 1024):
        req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "is-it-real-eval"})
        with urllib.request.urlopen(req, timeout=120) as r:
            self.url = r.geturl()  # after redirects
            self.size = int(r.headers["Content-Length"])
        self.pos = 0
        self.block = block
        self.cache = {}

    def seekable(self):
        return True

    def readable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, offset, whence=io.SEEK_SET):
        self.pos = offset if whence == io.SEEK_SET else self.pos + offset if whence == io.SEEK_CUR else self.size + offset
        return self.pos

    def _block(self, i: int) -> bytes:
        if i not in self.cache:
            start = i * self.block
            end = min(self.size, start + self.block) - 1
            req = urllib.request.Request(self.url, headers={"Range": f"bytes={start}-{end}", "User-Agent": "is-it-real-eval"})
            with urllib.request.urlopen(req, timeout=300) as r:
                self.cache[i] = r.read()
            if len(self.cache) > 8:
                self.cache.pop(next(iter(self.cache)))
        return self.cache[i]

    def read(self, n=-1):
        if n < 0:
            n = self.size - self.pos
        out = bytearray()
        while n > 0 and self.pos < self.size:
            i, off = divmod(self.pos, self.block)
            chunk = self._block(i)[off : off + n]
            if not chunk:
                break
            out += chunk
            self.pos += len(chunk)
            n -= len(chunk)
        return bytes(out)


def from_remote_zip(url: str, source: str, n: int, rows: list, license_: str) -> None:
    with zipfile.ZipFile(HttpRangeFile(url)) as z:
        names = sorted((i.filename for i in z.infolist() if i.filename.lower().endswith(IMAGE_EXT) and not i.is_dir()), key=rank)
        for name in names[:n]:
            save(rows, source, f"{url}#{name}", z.read(name), os.path.splitext(name)[1].lower(), "real", license_)


def fetch_phone(n: int, rows: list) -> None:
    url = f"{HF}/chaofengc/IQA-PyTorch-Datasets/resolve/main/spaq.tgz"
    req = urllib.request.Request(url, headers={"User-Agent": "is-it-real-eval"})
    got = 0
    with urllib.request.urlopen(req, timeout=600) as r, tarfile.open(fileobj=r, mode="r|gz") as tar:
        for m in tar:
            if got >= n:
                break
            if m.isfile() and m.name.lower().endswith(IMAGE_EXT):
                save(rows, "phone", f"spaq:{m.name}", tar.extractfile(m).read(), os.path.splitext(m.name)[1].lower(), "real", "SPAQ (research use); evaluation only")
                got += 1


def fetch_meme(n: int, rows: list) -> None:
    repo = "neuralcatcher/hateful_memes"
    api = json.loads(get(f"https://huggingface.co/api/datasets/{repo}"))
    files = sorted((s["rfilename"] for s in api["siblings"] if s["rfilename"].startswith("img/")), key=rank)
    for f in files[:n]:
        save(rows, "meme", f"{repo}/{f}", get(f"{HF}/{repo}/resolve/main/{f}"), ".png", "real", "Hateful Memes dataset terms; evaluation only")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-source", type=int, default=200)
    ap.add_argument("--only", default="phone,screenshot,meme,cartoon,digital_art,sketch,cosplay")
    args = ap.parse_args()
    only = args.only.split(",")
    manifest = os.path.join(ROOT, "manifest.jsonl")
    rows = [json.loads(l) for l in open(manifest) if l.strip()]
    rows = [r for r in rows if r["source"] not in only]
    human_art = lambda sub: f"{HF}/suxi123/Human-Art/resolve/main/images/{sub}.zip"  # noqa: E731
    jobs = {
        "phone": lambda: fetch_phone(args.per_source, rows),
        "screenshot": lambda: from_remote_zip(f"{HF}/OS-Copilot/ScreenSpot-v2/resolve/main/screenspotv2_image.zip", "screenshot", args.per_source, rows, "Apache-2.0"),
        "meme": lambda: fetch_meme(args.per_source, rows),
        "cartoon": lambda: from_remote_zip(human_art("2D_virtual_human/cartoon"), "cartoon", args.per_source, rows, "Human-Art terms; evaluation only"),
        "digital_art": lambda: from_remote_zip(human_art("2D_virtual_human/digital_art"), "digital_art", args.per_source, rows, "Human-Art terms; evaluation only"),
        "sketch": lambda: from_remote_zip(human_art("2D_virtual_human/sketch"), "sketch", args.per_source, rows, "Human-Art terms; evaluation only"),
        "cosplay": lambda: from_remote_zip(human_art("real_human/cosplay"), "cosplay", args.per_source, rows, "Human-Art terms; evaluation only"),
    }
    for name in only:
        before = len(rows)
        try:
            jobs[name]()
            print(f"{name}: {len(rows) - before} images", flush=True)
        except Exception as e:  # noqa: BLE001
            print(f"{name}: FAILED ({type(e).__name__}: {e})", file=sys.stderr, flush=True)
        with open(manifest, "w") as f:
            for r in sorted(rows, key=lambda r: r["id"]):
                f.write(json.dumps(r) + "\n")
    print(f"manifest: {len(rows)} rows")
    return 0


if __name__ == "__main__":
    sys.exit(main())
