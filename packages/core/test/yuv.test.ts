import { describe, expect, it } from 'vitest';
import {
  parseY4mFrame,
  yuv420ToPixels,
  yuvFrameFromPlanes,
  yuvMatrixFor,
  type YuvFrame,
} from '../src/index.js';

/** Made-up planes from the same simple generator as eval/reference/yuv.py --selftest. */
function madeUp(width: number, height: number, fullRange: boolean): YuvFrame {
  const cw = (width + 1) >> 1;
  const ch = (height + 1) >> 1;
  const values = new Uint8Array(width * height + 2 * cw * ch);
  let state = 12345 + width * 31 + height;
  for (let k = 0; k < values.length; k++) {
    state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff;
    values[k] = (state >> 16) & 255;
  }
  return {
    width,
    height,
    y: values.subarray(0, width * height),
    u: values.subarray(width * height, width * height + cw * ch),
    v: values.subarray(width * height + cw * ch),
    fullRange,
  };
}

function rgbChecksum(frame: YuvFrame): number {
  const { data } = yuv420ToPixels(frame);
  let sum = 0;
  let k = 0;
  for (let i = 0; i < data.length; i += 4)
    for (let c = 0; c < 3; c++, k++) sum = (sum + data[i + c]! * ((k % 251) + 1)) % 1000000007;
  return sum;
}

describe('yuv420ToPixels', () => {
  // Checksums printed by `python3 -I eval/reference/yuv.py --selftest`: the evaluation's
  // conversion and this one must give the same bytes, for odd sizes, both matrices and both ranges.
  it.each([
    [7, 5, false, 755921],
    [64, 48, false, 147524359],
    [1280, 6, true, 364015532],
    [33, 600, false, 967352297],
  ] as const)('matches the Python copy for %i x %i (full range: %s)', (w, h, full, expected) => {
    expect(rgbChecksum(madeUp(w, h, full))).toBe(expected);
  });

  it('turns plain grey, black and white into grey, black and white', () => {
    const flat = (luma: number): YuvFrame => ({
      width: 4,
      height: 2,
      y: new Uint8Array(8).fill(luma),
      u: new Uint8Array(2).fill(128),
      v: new Uint8Array(2).fill(128),
      fullRange: false,
    });
    expect([...yuv420ToPixels(flat(16)).data.subarray(0, 4)]).toEqual([0, 0, 0, 255]);
    expect([...yuv420ToPixels(flat(235)).data.subarray(0, 4)]).toEqual([255, 255, 255, 255]);
    expect([...yuv420ToPixels(flat(126)).data.subarray(0, 4)]).toEqual([128, 128, 128, 255]);
    // Full range keeps the numbers as they are.
    expect([...yuv420ToPixels({ ...flat(200), fullRange: true }).data.subarray(0, 3)]).toEqual([
      200, 200, 200,
    ]);
  });

  it('uses the HD colour rule for HD sizes only', () => {
    expect(yuvMatrixFor(1280, 720)).toBe('bt709');
    expect(yuvMatrixFor(1920, 1080)).toBe('bt709');
    expect(yuvMatrixFor(1024, 600)).toBe('bt709');
    expect(yuvMatrixFor(854, 480)).toBe('bt601');
    expect(yuvMatrixFor(298, 224)).toBe('bt601');
  });

  it('refuses planes that are too small for the frame', () => {
    const frame = madeUp(8, 8, false);
    expect(() => yuv420ToPixels({ ...frame, u: frame.u.subarray(1) })).toThrow();
  });
});

describe('parseY4mFrame', () => {
  const y4m = (header: string, frame: YuvFrame): Uint8Array => {
    const text = new TextEncoder().encode(`${header}\nFRAME\n`);
    const out = new Uint8Array(text.length + frame.y.length + frame.u.length + frame.v.length);
    out.set(text);
    out.set(frame.y, text.length);
    out.set(frame.u, text.length + frame.y.length);
    out.set(frame.v, text.length + frame.y.length + frame.u.length);
    return out;
  };

  it('reads the first frame of an 8-bit 4:2:0 stream', () => {
    const frame = madeUp(7, 5, false);
    const parsed = parseY4mFrame(
      y4m('YUV4MPEG2 W7 H5 F24:1 Ip A1:1 C420mpeg2 XCOLORRANGE=LIMITED', frame),
    )!;
    expect(parsed).toMatchObject({ width: 7, height: 5, fullRange: false });
    expect(rgbChecksum(parsed)).toBe(755921);
    expect(
      parseY4mFrame(y4m('YUV4MPEG2 W7 H5 F24:1 Ip A1:1 C420jpeg XCOLORRANGE=FULL', frame))!
        .fullRange,
    ).toBe(true);
  });

  it('refuses other layouts, bit depths and cut-off data', () => {
    const frame = madeUp(8, 4, false);
    expect(parseY4mFrame(y4m('YUV4MPEG2 W8 H4 F24:1 C422', frame))).toBeNull();
    expect(parseY4mFrame(y4m('YUV4MPEG2 W8 H4 F24:1 C420p10', frame))).toBeNull();
    expect(parseY4mFrame(y4m('YUV4MPEG2 W8 H4 F24:1 C420jpeg', frame).subarray(0, 60))).toBeNull();
    expect(parseY4mFrame(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(parseY4mFrame(y4m('YUV4MPEG2 W0 H4 C420', frame))).toBeNull();
  });
});

describe('yuvFrameFromPlanes', () => {
  it('reads three planes with padded rows (I420)', () => {
    const frame = madeUp(6, 4, false);
    // Rows padded to 8 (luma) and 5 (colour), as decoders often do.
    const data = new Uint8Array(8 * 4 + 5 * 2 + 5 * 2).fill(99);
    for (let r = 0; r < 4; r++) data.set(frame.y.subarray(r * 6, r * 6 + 6), r * 8);
    for (let r = 0; r < 2; r++) {
      data.set(frame.u.subarray(r * 3, r * 3 + 3), 32 + r * 5);
      data.set(frame.v.subarray(r * 3, r * 3 + 3), 42 + r * 5);
    }
    const layout = [
      { offset: 0, stride: 8 },
      { offset: 32, stride: 5 },
      { offset: 42, stride: 5 },
    ];
    const got = yuvFrameFromPlanes('I420', data, layout, 6, 4, false)!;
    expect(rgbChecksum(got)).toBe(rgbChecksum(frame));
  });

  it('reads interleaved colour planes (NV12)', () => {
    const frame = madeUp(6, 4, true);
    const data = new Uint8Array(6 * 4 + 6 * 2);
    data.set(frame.y);
    for (let k = 0; k < 6; k++) {
      data[24 + k * 2] = frame.u[k]!;
      data[24 + k * 2 + 1] = frame.v[k]!;
    }
    const layout = [
      { offset: 0, stride: 6 },
      { offset: 24, stride: 6 },
    ];
    expect(rgbChecksum(yuvFrameFromPlanes('NV12', data, layout, 6, 4, true)!)).toBe(
      rgbChecksum(frame),
    );
  });

  it('refuses other layouts and data that is too short', () => {
    const data = new Uint8Array(100);
    const layout = [{ offset: 0, stride: 6 }];
    expect(yuvFrameFromPlanes('I444', data, layout, 6, 4, false)).toBeNull();
    expect(yuvFrameFromPlanes('RGBA', data, layout, 6, 4, false)).toBeNull();
    expect(yuvFrameFromPlanes('I420', data, layout, 6, 4, false)).toBeNull();
    expect(yuvFrameFromPlanes('NV12', new Uint8Array(10), layout, 6, 4, false)).toBeNull();
  });
});
