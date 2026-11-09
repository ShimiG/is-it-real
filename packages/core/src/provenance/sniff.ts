/**
 * Cheap byte-level sniffers for provenance markers.
 *
 * These only check whether markers are PRESENT. They do not validate signatures, so they must
 * never produce `verified_ai` on their own. Full C2PA validation (signature, hard binding,
 * trust list) arrives in M3 via @contentauth/c2pa-web. Uses: the M0 provenance census, and
 * a fast pre-filter before the expensive validator.
 */

export type ImageFormat = 'jpeg' | 'png' | 'webp' | 'gif' | 'avif' | 'unknown';

export interface SniffResult {
  format: ImageFormat;
  /** A C2PA manifest store appears to be embedded (JUMBF "c2pa" box, PNG caBX chunk, RIFF C2PA chunk). */
  c2pa: boolean;
  /** IPTC digital source type codes that indicate generative AI, found anywhere in the file (XMP or C2PA). */
  aiSourceTypes: AiSourceType[];
  /** Generator traces such as Stable Diffusion "parameters" or ComfyUI "workflow" text chunks. */
  generatorHints: string[];
}

export const AI_SOURCE_TYPES = [
  'trainedAlgorithmicMedia',
  'compositeWithTrainedAlgorithmicMedia',
] as const;
export type AiSourceType = (typeof AI_SOURCE_TYPES)[number];

const IPTC_DST_PREFIX = 'digitalsourcetype/';

/** PNG tEXt/iTXt/zTXt keywords written by common image generators. */
const PNG_GENERATOR_KEYWORDS: Record<string, string> = {
  parameters: 'stable-diffusion-webui',
  prompt: 'comfyui',
  workflow: 'comfyui',
  'sd-metadata': 'invokeai',
  invokeai_metadata: 'invokeai',
  dream: 'invokeai',
};

export function detectFormat(b: Uint8Array): ImageFormat {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 8 && ascii(b, 0, 8) === '\x89PNG\r\n\x1a\n') return 'png';
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'webp';
  if (b.length >= 6 && ascii(b, 0, 3) === 'GIF') return 'gif';
  if (b.length >= 12 && ascii(b, 4, 4) === 'ftyp' && /^avi[fs]$/.test(ascii(b, 8, 4)))
    return 'avif';
  return 'unknown';
}

export function sniffImage(bytes: Uint8Array): SniffResult {
  const format = detectFormat(bytes);
  // latin1 keeps a 1:1 byte<->char mapping, so ASCII markers can be searched as strings.
  const text = latin1(bytes);

  let c2pa = text.includes('jumb') && text.includes('c2pa');
  const generatorHints: string[] = [];

  if (format === 'png') {
    for (const chunk of pngChunks(bytes)) {
      if (chunk.type === 'caBX') c2pa = true;
      if (chunk.type === 'tEXt' || chunk.type === 'iTXt' || chunk.type === 'zTXt') {
        const keyword = chunk.keyword.toLowerCase();
        const tool = PNG_GENERATOR_KEYWORDS[keyword];
        if (tool !== undefined) generatorHints.push(`${tool}:${keyword}`);
      }
    }
  }
  if (format === 'webp' && text.includes('C2PA')) c2pa = c2pa || riffHasChunk(bytes, 'C2PA');

  // Stable Diffusion WebUI writes its settings into JPEG EXIF UserComment, often as UTF-16.
  if (looksLikeSdParameters(text) || looksLikeSdParameters(utf16leToAscii(bytes))) {
    generatorHints.push('stable-diffusion-webui:exif');
  }

  const lower = text.toLowerCase();
  const aiSourceTypes = AI_SOURCE_TYPES.filter(
    (code) =>
      lower.includes((IPTC_DST_PREFIX + code).toLowerCase()) ||
      // XMP/C2PA may also carry the bare code next to a digitalSourceType key.
      (lower.includes('digitalsourcetype') && hasWord(text, code)),
  );

  return { format, c2pa, aiSourceTypes, generatorHints: [...new Set(generatorHints)] };
}

interface PngChunk {
  type: string;
  keyword: string;
}

function* pngChunks(b: Uint8Array): Generator<PngChunk> {
  let off = 8;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  while (off + 8 <= b.length) {
    const len = view.getUint32(off);
    const type = ascii(b, off + 4, 4);
    const dataStart = off + 8;
    const dataEnd = Math.min(dataStart + len, b.length);
    let keyword = '';
    if (type === 'tEXt' || type === 'iTXt' || type === 'zTXt') {
      const nul = b.indexOf(0, dataStart);
      if (nul !== -1 && nul < dataEnd) keyword = ascii(b, dataStart, nul - dataStart);
    }
    yield { type, keyword };
    if (type === 'IEND') return;
    off = dataStart + len + 4; // + CRC
  }
}

function riffHasChunk(b: Uint8Array, fourcc: string): boolean {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let off = 12;
  while (off + 8 <= b.length) {
    if (ascii(b, off, 4) === fourcc) return true;
    const size = view.getUint32(off + 4, true);
    off += 8 + size + (size % 2);
  }
  return false;
}

function looksLikeSdParameters(s: string): boolean {
  return s.includes('Steps: ') && s.includes('Sampler: ') && s.includes('CFG scale: ');
}

function hasWord(haystack: string, word: string): boolean {
  return new RegExp(`(^|[^A-Za-z])${word}([^A-Za-z]|$)`).test(haystack);
}

function ascii(b: Uint8Array, start: number, len: number): string {
  let s = '';
  for (let i = start; i < start + len && i < b.length; i++) s += String.fromCharCode(b[i]!);
  return s;
}

function latin1(b: Uint8Array): string {
  return new TextDecoder('latin1').decode(b);
}

/** Collapse UTF-16LE ASCII text (char, 0x00, char, 0x00...) into plain ASCII for searching. */
function utf16leToAscii(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i + 1 < b.length; i += 2) {
    if (b[i + 1] === 0 && b[i]! >= 0x20 && b[i]! < 0x7f) s += String.fromCharCode(b[i]!);
    else s += '\n';
  }
  return s;
}
