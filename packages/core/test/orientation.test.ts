import { describe, expect, it } from 'vitest';
import { exifOrientation, undoOrientation, type Pixels } from '../src/index.js';

/** A minimal JPEG start with an EXIF block that carries only the orientation note. */
function jpegWithOrientation(value: number, littleEndian: boolean): Uint8Array {
  const u16 = (v: number) => (littleEndian ? [v & 255, v >> 8] : [v >> 8, v & 255]);
  const u32 = (v: number) =>
    littleEndian ? [v & 255, (v >> 8) & 255, 0, 0] : [0, 0, (v >> 8) & 255, v & 255];
  const tiff = [
    ...(littleEndian ? [0x49, 0x49] : [0x4d, 0x4d]),
    ...u16(42),
    ...u32(8),
    ...u16(1), // one entry
    ...u16(0x0112),
    ...u16(3), // SHORT
    ...u32(1),
    ...u16(value),
    0,
    0,
    ...u32(0),
  ];
  const exif = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const size = exif.length + 2;
  // An unrelated block first (JFIF), as real files have.
  const jfif = [0xff, 0xe0, 0, 4, 1, 2];
  return Uint8Array.from([
    0xff,
    0xd8,
    ...jfif,
    0xff,
    0xe1,
    size >> 8,
    size & 255,
    ...exif,
    0xff,
    0xda,
    0,
    2,
  ]);
}

/** A picture whose pixels are numbered, so every move can be followed. */
function numbered(width: number, height: number): Pixels {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([i, i + 100, 7, 255], i * 4);
  return { width, height, data };
}

/** What a browser does: show the stored picture the way the note says (EXIF definition). */
function show(stored: Pixels, orientation: number): Pixels {
  const { width: W, height: H } = stored;
  const swapped = orientation >= 5;
  const out: Pixels = {
    width: swapped ? H : W,
    height: swapped ? W : H,
    data: new Uint8Array(W * H * 4),
  };
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const [sx, sy] = (
        {
          1: [x, y],
          2: [W - 1 - x, y],
          3: [W - 1 - x, H - 1 - y],
          4: [x, H - 1 - y],
          5: [y, x],
          6: [H - 1 - y, x],
          7: [H - 1 - y, W - 1 - x],
          8: [y, W - 1 - x],
        } as Record<number, [number, number]>
      )[orientation]!;
      out.data.set(
        stored.data.subarray((y * W + x) * 4, (y * W + x) * 4 + 4),
        (sy * out.width + sx) * 4,
      );
    }
  return out;
}

describe('exifOrientation', () => {
  it('reads the note in both byte orders', () => {
    for (const value of [1, 3, 6, 8]) {
      expect(exifOrientation(jpegWithOrientation(value, true))).toBe(value);
      expect(exifOrientation(jpegWithOrientation(value, false))).toBe(value);
    }
  });

  it('answers 1 for files without a usable note', () => {
    expect(exifOrientation(new Uint8Array(0))).toBe(1);
    expect(exifOrientation(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBe(1);
    expect(exifOrientation(Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBe(1);
    expect(exifOrientation(jpegWithOrientation(9, true))).toBe(1);
    // Cut off in the middle of the EXIF block.
    expect(exifOrientation(jpegWithOrientation(6, true).subarray(0, 24))).toBe(1);
  });
});

describe('undoOrientation', () => {
  it('turns a phone photo taken upright back to its stored, sideways pixels', () => {
    // Stored 3 wide, 2 high; note 6 = "turn a quarter clockwise to show".
    const stored = numbered(3, 2);
    const shown = show(stored, 6);
    expect([shown.width, shown.height]).toEqual([2, 3]);
    // The stored top-left pixel is shown top-right.
    expect(shown.data[1 * 4]).toBe(0);
    expect(undoOrientation(shown, 6)).toEqual(stored);
  });

  it('undoes every one of the eight notes', () => {
    const stored = numbered(4, 3);
    for (let o = 1; o <= 8; o++)
      expect(undoOrientation(show(stored, o), o), `orientation ${o}`).toEqual(
        o === 1 ? show(stored, 1) : stored,
      );
  });

  it('leaves the picture alone for a missing or impossible note', () => {
    const p = numbered(2, 2);
    expect(undoOrientation(p, 1)).toBe(p);
    expect(undoOrientation(p, 0)).toBe(p);
    expect(undoOrientation(p, 9)).toBe(p);
  });
});
