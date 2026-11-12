import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpegStatic from 'ffmpeg-static';
import { describe, expect, it } from 'vitest';
import { extractFrames, ffmpegWorks, frameAt, videoDuration, videoFormatOf } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const mp4 = join(here, 'fixtures', 'testsrc.mp4');
const webm = join(here, 'fixtures', 'testsrc.webm');
/** The packaged ffmpeg (a development dependency), so the tests do not need one on the machine. */
const ffmpeg = ffmpegStatic as unknown as string;
const tmp = mkdtempSync(join(tmpdir(), 'isitreal-video-'));

describe('ffmpeg frame reader', () => {
  it('finds a working ffmpeg and rejects something that is not one', async () => {
    expect(await ffmpegWorks(ffmpeg)).toBe(true);
    expect(await ffmpegWorks(join(tmp, 'no-such-program'))).toBe(false);
    expect(await ffmpegWorks(process.execPath)).toBe(false);
  });

  it('recognises the container from the first bytes, not the name', async () => {
    expect(await videoFormatOf(mp4)).toBe('mp4');
    expect(await videoFormatOf(webm)).toBe('webm');
    expect(await videoFormatOf(join(here, 'ffmpeg.test.ts'))).toBe('unknown');
    expect(await videoFormatOf(join(tmp, 'missing.mp4'))).toBe('unknown');
  });

  it('reads the duration', async () => {
    expect(await videoDuration(ffmpeg, mp4)).toBeCloseTo(3, 1);
    expect(await videoDuration(ffmpeg, webm)).toBeCloseTo(3, 1);
  });

  it('extracts evenly spaced frames at full size', async () => {
    for (const file of [mp4, webm]) {
      const frames = await extractFrames(ffmpeg, file, 6);
      expect(frames).toHaveLength(6);
      for (const f of frames) {
        expect([f.width, f.height]).toEqual([320, 240]);
        expect(f.data.length).toBe(320 * 240 * 4);
      }
      // The test pattern moves, so frames taken at different times differ.
      expect(Buffer.from(frames[0]!.data).equals(Buffer.from(frames[5]!.data))).toBe(false);
      // Colour order: the pattern is not grey, and alpha is opaque.
      const d = frames[0]!.data;
      expect(d[3]).toBe(255);
      let coloured = 0;
      for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i]! - d[i + 2]!) > 60) coloured++;
      expect(coloured).toBeGreaterThan(1000);
    }
  }, 60_000);

  it('gives the same frame for the same time', async () => {
    const a = await frameAt(ffmpeg, mp4, 1.25);
    const b = await frameAt(ffmpeg, mp4, 1.25);
    expect(a).not.toBeNull();
    expect(Buffer.from(a!.data).equals(Buffer.from(b!.data))).toBe(true);
  });

  it('never opens a playlist or script that is only named like a video', async () => {
    // An HLS playlist pointing at a local file: ffmpeg would follow it if asked to guess the type.
    const playlist = join(tmp, 'trick.mp4');
    writeFileSync(
      playlist,
      `#EXTM3U\n#EXT-X-TARGETDURATION:3\n#EXTINF:3,\n${mp4}\n#EXT-X-ENDLIST\n`,
    );
    expect(await videoFormatOf(playlist)).toBe('unknown');
    expect(await videoDuration(ffmpeg, playlist)).toBeNull();
    expect(await extractFrames(ffmpeg, playlist, 6)).toEqual([]);
    // A text file with an MP4-looking start is handed to the MP4 reader only, which rejects it.
    const fake = join(tmp, 'fake.mp4');
    writeFileSync(
      fake,
      Buffer.concat([
        Buffer.from([0, 0, 0, 24]),
        Buffer.from('ftypisom'),
        Buffer.from('#EXTM3U\nnot a video\n'),
      ]),
    );
    expect(await videoFormatOf(fake)).toBe('mp4');
    expect(await extractFrames(ffmpeg, fake, 6)).toEqual([]);
  });

  it('returns nothing for a missing file or a truncated video', async () => {
    expect(await extractFrames(ffmpeg, join(tmp, 'missing.mp4'), 6)).toEqual([]);
    const cut = join(tmp, 'cut.mp4');
    writeFileSync(cut, (await import('node:fs')).readFileSync(mp4).subarray(0, 600));
    expect(await extractFrames(ffmpeg, cut, 6)).toEqual([]);
  });
  it('reads only 8-bit 4:2:0 video; other layouts are refused, not converted by another rule', async () => {
    const make = (name: string, pixFmt: string) => {
      const out = join(tmp, name);
      const r = spawnSync(
        ffmpeg,
        [
          '-v',
          'error',
          '-y',
          '-f',
          'lavfi',
          '-i',
          'testsrc=d=1:s=64x48:r=5',
          '-pix_fmt',
          pixFmt,
          '-c:v',
          'libx264',
          out,
        ],
        { encoding: 'utf8' },
      );
      if (r.status !== 0) throw new Error(r.stderr);
      return out;
    };
    expect(await frameAt(ffmpeg, make('plain.mp4', 'yuv420p'), 0.4)).toMatchObject({
      width: 64,
      height: 48,
    });
    // Full-range video is read, with its own conversion numbers.
    expect(await frameAt(ffmpeg, make('full.mp4', 'yuvj420p'), 0.4)).not.toBeNull();
    expect(await frameAt(ffmpeg, make('444.mp4', 'yuv444p'), 0.4)).toBeNull();
    expect(await frameAt(ffmpeg, make('10bit.mp4', 'yuv420p10le'), 0.4)).toBeNull();
  }, 60_000);
});
