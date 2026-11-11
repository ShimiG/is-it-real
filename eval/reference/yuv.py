"""From a video decoder's raw output (YUV 4:2:0) to RGB, with the project's one fixed rule.

The Python copy of packages/core/src/video/yuv.ts. Both use integers only and give the same
bytes (checked by packages/core/test/yuv.test.ts against a checksum made here:
`python3 -I eval/reference/yuv.py --selftest`). See that file for why this exists.
"""

import subprocess
import sys

import numpy as np
from PIL import Image

COEFFICIENTS = {
    ("bt601", False): (76309, 104597, -25675, -53279, 132201, 16),
    ("bt601", True): (65536, 91881, -22553, -46802, 116130, 0),
    ("bt709", False): (76309, 117489, -13975, -34925, 138438, 16),
    ("bt709", True): (65536, 103206, -12276, -30679, 121609, 0),
}


def matrix_for(width: int, height: int) -> str:
    return "bt709" if width >= 1280 or height > 576 else "bt601"


def upsample(c: np.ndarray, width: int, height: int) -> np.ndarray:
    """Half-resolution colour plane to full size: 9:3:3:1 weights, edges repeated."""
    ch, cw = c.shape
    c = c.astype(np.int32)
    ys = np.arange(height)
    xs = np.arange(width)
    j = ys >> 1
    i = xs >> 1
    j2 = np.clip(np.where(ys & 1, j + 1, j - 1), 0, ch - 1)
    i2 = np.clip(np.where(xs & 1, i + 1, i - 1), 0, cw - 1)
    a = c[j][:, i]
    b = c[j][:, i2]
    d = c[j2][:, i]
    e = c[j2][:, i2]
    return (9 * a + 3 * b + 3 * d + e + 8) >> 4


def to_rgb(width: int, height: int, y: np.ndarray, u: np.ndarray, v: np.ndarray, full_range: bool) -> np.ndarray:
    """uint8 [height, width, 3]."""
    ky, krv, kgu, kgv, kbu, offset = COEFFICIENTS[(matrix_for(width, height), full_range)]
    cb = upsample(u, width, height) - 128
    cr = upsample(v, width, height) - 128
    luma = ky * (y.astype(np.int32) - offset) + 32768
    r = (luma + krv * cr) >> 16
    g = (luma + kgu * cb + kgv * cr) >> 16
    b = (luma + kbu * cb) >> 16
    return np.clip(np.stack([r, g, b], axis=-1), 0, 255).astype(np.uint8)


def parse_y4m_frame(data: bytes):
    """First frame of a YUV4MPEG2 stream -> (width, height, y, u, v, full_range), or None."""
    end = data.find(b"\n")
    if end < 0 or end > 512 or not data.startswith(b"YUV4MPEG2 "):
        return None
    width = height = 0
    chroma = "420"
    full = False
    for field in data[:end].decode("latin1").split(" ")[1:]:
        if field.startswith("W"):
            width = int(field[1:])
        elif field.startswith("H"):
            height = int(field[1:])
        elif field.startswith("C"):
            chroma = field[1:]
        elif field == "XCOLORRANGE=FULL":
            full = True
    if width <= 0 or height <= 0 or chroma not in ("420", "420jpeg", "420mpeg2", "420paldv"):
        return None
    frame_end = data.find(b"\n", end + 1)
    if frame_end < 0 or not data[end + 1 : frame_end].startswith(b"FRAME"):
        return None
    cw, ch = (width + 1) >> 1, (height + 1) >> 1
    start = frame_end + 1
    if start + width * height + 2 * cw * ch > len(data):
        return None
    buf = np.frombuffer(data, np.uint8, offset=start, count=width * height + 2 * cw * ch)
    y = buf[: width * height].reshape(height, width)
    u = buf[width * height : width * height + cw * ch].reshape(ch, cw)
    v = buf[width * height + cw * ch :].reshape(ch, cw)
    return width, height, y, u, v, full


def frame_at(path: str, t: float, timeout: int = 600):
    """One decoded frame at time t (seconds) as an RGB image; None if it cannot be read or is not 8-bit 4:2:0."""
    try:
        data = subprocess.run(
            ["ffmpeg", "-v", "error", "-nostdin", "-ss", f"{t:.3f}", "-i", path, "-frames:v", "1", "-f", "yuv4mpegpipe", "-"],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=timeout,
            check=False,
        ).stdout
    except Exception:  # noqa: BLE001
        return None
    parsed = parse_y4m_frame(data)
    if parsed is None:
        return None
    return Image.fromarray(to_rgb(*parsed), "RGB")


def selftest() -> None:
    """Prints checksums of the conversion on made-up frames (compared with the TypeScript copy)."""
    for width, height, full in [(7, 5, False), (64, 48, False), (1280, 6, True), (33, 600, False)]:
        cw, ch = (width + 1) >> 1, (height + 1) >> 1
        n = width * height + 2 * cw * ch
        # The same simple generator as in the TypeScript test.
        state = 12345 + width * 31 + height
        vals = np.empty(n, np.uint8)
        for k in range(n):
            state = (state * 1103515245 + 12345) & 0x7FFFFFFF
            vals[k] = (state >> 16) & 255
        y = vals[: width * height].reshape(height, width)
        u = vals[width * height : width * height + cw * ch].reshape(ch, cw)
        v = vals[width * height + cw * ch :].reshape(ch, cw)
        rgb = to_rgb(width, height, y, u, v, full).reshape(-1).astype(np.int64)
        checksum = int((rgb * (np.arange(rgb.size) % 251 + 1)).sum() % 1000000007)
        print(f"[{width}, {height}, {str(full).lower()}, {checksum}],")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
