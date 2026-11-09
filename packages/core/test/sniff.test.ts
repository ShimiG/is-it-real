import { describe, expect, it } from 'vitest';
import { detectFormat, sniffImage } from '../src/index.js';

const enc = (s: string) => new TextEncoder().encode(s);
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
const u32 = (n: number) =>
  new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);

const PNG_SIG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pngChunk = (type: string, data: Uint8Array) =>
  concat(u32(data.length), enc(type), data, u32(0));
const png = (...chunks: Uint8Array[]) =>
  concat(
    PNG_SIG,
    pngChunk('IHDR', new Uint8Array(13)),
    ...chunks,
    pngChunk('IEND', new Uint8Array()),
  );

const JPEG_SOI = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

describe('detectFormat', () => {
  it('recognises PNG and JPEG', () => {
    expect(detectFormat(png())).toBe('png');
    expect(detectFormat(JPEG_SOI)).toBe('jpeg');
    expect(detectFormat(enc('hello'))).toBe('unknown');
  });
});

describe('sniffImage', () => {
  it('finds nothing in a plain PNG', () => {
    expect(sniffImage(png())).toEqual({
      format: 'png',
      c2pa: false,
      aiSourceTypes: [],
      generatorHints: [],
    });
  });

  it('detects a PNG caBX (C2PA) chunk', () => {
    expect(sniffImage(png(pngChunk('caBX', enc('....')))).c2pa).toBe(true);
  });

  it('detects Stable Diffusion and ComfyUI text chunks', () => {
    const r = sniffImage(
      png(
        pngChunk('tEXt', enc('parameters\0a cat, Steps: 20')),
        pngChunk('tEXt', enc('workflow\0{}')),
      ),
    );
    expect(r.generatorHints).toEqual(['stable-diffusion-webui:parameters', 'comfyui:workflow']);
  });

  it('detects a JPEG JUMBF C2PA box', () => {
    const app11 = concat(new Uint8Array([0xff, 0xeb, 0x00, 0x20]), enc('JP..jumb....jumdc2pa'));
    expect(sniffImage(concat(JPEG_SOI, app11)).c2pa).toBe(true);
  });

  it('detects the IPTC trainedAlgorithmicMedia source type in XMP', () => {
    const xmp = enc(
      '<Iptc4xmpExt:DigitalSourceType>http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia</Iptc4xmpExt:DigitalSourceType>',
    );
    expect(sniffImage(concat(JPEG_SOI, xmp)).aiSourceTypes).toEqual(['trainedAlgorithmicMedia']);
  });

  it('does not confuse composite and plain trained codes', () => {
    const xmp = enc('digitalsourcetype/compositeWithTrainedAlgorithmicMedia');
    expect(sniffImage(concat(JPEG_SOI, xmp)).aiSourceTypes).toEqual([
      'compositeWithTrainedAlgorithmicMedia',
    ]);
  });

  it('detects SD WebUI parameters stored as UTF-16 EXIF UserComment', () => {
    const text = 'a cat\nSteps: 20, Sampler: Euler a, CFG scale: 7';
    const utf16 = new Uint8Array(text.length * 2);
    for (let i = 0; i < text.length; i++) utf16[i * 2] = text.charCodeAt(i);
    expect(sniffImage(concat(JPEG_SOI, enc('UNICODE\0'), utf16)).generatorHints).toEqual([
      'stable-diffusion-webui:exif',
    ]);
  });
});
