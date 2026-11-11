import type { Pixels } from '../image/spectral.js';

/**
 * From a video decoder's raw output (YUV 4:2:0) to RGB pixels, with ONE fixed rule.
 *
 * Why this exists: decoders agree bit for bit on the raw YUV planes of a frame, but every
 * program turns them into RGB its own way (which colour matrix, how the half-resolution colour
 * planes are stretched). The picture model reacts to those differences: the same frame scored
 * 1 to 2 points apart between ffmpeg's default conversion and a browser's (docs/eval/m5-results.md).
 * So every host (plugin, extension, evaluation) takes the raw planes and converts them here.
 *
 * The rule, in integers only so that the Python copy (eval/reference/yuv.py) gives the same bytes:
 * - colour planes are stretched to full size with the usual 9:3:3:1 weights (bilinear, centred);
 * - BT.709 for HD sizes (width >= 1280 or height > 576), BT.601 otherwise; tags in the file are
 *   not used, because a browser cannot tell a real tag from its own guess;
 * - limited ("TV") range unless the stream says full range.
 */
export interface YuvFrame {
  width: number;
  height: number;
  /** Luma, width x height. */
  y: Uint8Array;
  /** Colour planes, ceil(width / 2) x ceil(height / 2) each. */
  u: Uint8Array;
  v: Uint8Array;
  fullRange: boolean;
}

export type YuvMatrix = 'bt601' | 'bt709';

export const yuvMatrixFor = (width: number, height: number): YuvMatrix =>
  width >= 1280 || height > 576 ? 'bt709' : 'bt601';

/** Coefficients times 65536: [luma gain, V to R, U to G, V to G, U to B, luma offset]. */
const COEFFICIENTS: Record<YuvMatrix, Record<'limited' | 'full', readonly number[]>> = {
  bt601: {
    limited: [76309, 104597, -25675, -53279, 132201, 16],
    full: [65536, 91881, -22553, -46802, 116130, 0],
  },
  bt709: {
    limited: [76309, 117489, -13975, -34925, 138438, 16],
    full: [65536, 103206, -12276, -30679, 121609, 0],
  },
};

const clamp = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);

export function yuv420ToPixels(frame: YuvFrame): Pixels {
  const { width: w, height: h, y, u, v } = frame;
  const cw = (w + 1) >> 1;
  const ch = (h + 1) >> 1;
  if (y.length < w * h || u.length < cw * ch || v.length < cw * ch)
    throw new Error('YUV planes are smaller than the frame');
  const [ky, krv, kgu, kgv, kbu, offset] = COEFFICIENTS[yuvMatrixFor(w, h)][
    frame.fullRange ? 'full' : 'limited'
  ] as [number, number, number, number, number, number];
  const data = new Uint8Array(w * h * 4);
  for (let py = 0; py < h; py++) {
    const j = py >> 1;
    // The nearer neighbour row of the colour plane: above for even rows, below for odd ones.
    const j2 = Math.min(ch - 1, Math.max(0, (py & 1) === 1 ? j + 1 : j - 1));
    const row = j * cw;
    const row2 = j2 * cw;
    for (let px = 0; px < w; px++) {
      const i = px >> 1;
      const i2 = Math.min(cw - 1, Math.max(0, (px & 1) === 1 ? i + 1 : i - 1));
      const cb =
        ((9 * u[row + i]! + 3 * u[row + i2]! + 3 * u[row2 + i]! + u[row2 + i2]! + 8) >> 4) - 128;
      const cr =
        ((9 * v[row + i]! + 3 * v[row + i2]! + 3 * v[row2 + i]! + v[row2 + i2]! + 8) >> 4) - 128;
      const luma = ky * (y[py * w + px]! - offset) + 32768;
      const at = (py * w + px) * 4;
      data[at] = clamp((luma + krv * cr) >> 16);
      data[at + 1] = clamp((luma + kgu * cb + kgv * cr) >> 16);
      data[at + 2] = clamp((luma + kbu * cb) >> 16);
      data[at + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

/**
 * The first frame of a YUV4MPEG2 stream (what `ffmpeg -f yuv4mpegpipe` writes): the decoder's
 * planes with a small text header. Null when it is not 8-bit 4:2:0 (other layouts are rare on
 * the web and are not checked rather than converted by a second rule).
 */
export function parseY4mFrame(buf: Uint8Array): YuvFrame | null {
  const lineEnd = buf.indexOf(0x0a);
  if (lineEnd < 0 || lineEnd > 512) return null;
  const header = new TextDecoder('latin1').decode(buf.subarray(0, lineEnd));
  if (!header.startsWith('YUV4MPEG2 ')) return null;
  let width = 0;
  let height = 0;
  let chroma = '420';
  let fullRange = false;
  for (const field of header.split(' ').slice(1)) {
    if (field.startsWith('W')) width = Number(field.slice(1));
    else if (field.startsWith('H')) height = Number(field.slice(1));
    else if (field.startsWith('C')) chroma = field.slice(1);
    else if (field === 'XCOLORRANGE=FULL') fullRange = true;
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0)
    return null;
  // 8-bit 4:2:0 in its three spellings; anything with a bit depth or another layout is refused.
  if (!['420', '420jpeg', '420mpeg2', '420paldv'].includes(chroma)) return null;
  const frameEnd = buf.indexOf(0x0a, lineEnd + 1);
  if (
    frameEnd < 0 ||
    !new TextDecoder('latin1').decode(buf.subarray(lineEnd + 1, frameEnd)).startsWith('FRAME')
  )
    return null;
  const cw = (width + 1) >> 1;
  const ch = (height + 1) >> 1;
  const start = frameEnd + 1;
  if (start + width * height + 2 * cw * ch > buf.length) return null;
  const y = buf.subarray(start, start + width * height);
  const u = buf.subarray(start + width * height, start + width * height + cw * ch);
  const v = buf.subarray(start + width * height + cw * ch, start + width * height + 2 * cw * ch);
  return { width, height, y, u, v, fullRange };
}

/** One plane of a frame copied out of a decoder: where it starts and how long each row is. */
export interface PlaneLayout {
  offset: number;
  stride: number;
}

/**
 * A frame as a browser's decoder hands it over (WebCodecs `VideoFrame.copyTo`): `I420` (three
 * planes) or `NV12` (luma, then the two colour planes interleaved). Null for other layouts.
 */
export function yuvFrameFromPlanes(
  format: string | null,
  data: Uint8Array,
  layout: readonly PlaneLayout[],
  width: number,
  height: number,
  fullRange: boolean,
): YuvFrame | null {
  const cw = (width + 1) >> 1;
  const ch = (height + 1) >> 1;
  const plane = (index: number, w: number, h: number, step = 1, phase = 0): Uint8Array | null => {
    const l = layout[index];
    if (l === undefined || l.offset + l.stride * (h - 1) + (w - 1) * step + phase >= data.length)
      return null;
    const out = new Uint8Array(w * h);
    for (let r = 0; r < h; r++)
      for (let c = 0; c < w; c++)
        out[r * w + c] = data[l.offset + r * l.stride + c * step + phase]!;
    return out;
  };
  const y = plane(0, width, height);
  let u: Uint8Array | null;
  let v: Uint8Array | null;
  if (format === 'I420' || format === 'I420A') {
    u = plane(1, cw, ch);
    v = plane(2, cw, ch);
  } else if (format === 'NV12') {
    u = plane(1, cw, ch, 2, 0);
    v = plane(1, cw, ch, 2, 1);
  } else return null;
  return y === null || u === null || v === null ? null : { width, height, y, u, v, fullRange };
}
