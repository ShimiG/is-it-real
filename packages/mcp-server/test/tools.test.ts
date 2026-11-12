import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Pixels, PreprocessSpec, VideoFrameCheck } from '@isitreal/core';
import {
  MAX_VIDEOS,
  checkImageTool,
  checkPageTool,
  checkTextTool,
  checkVideoTool,
  type Capabilities,
  type VideoCheck,
} from '../src/tools.js';

const noC2pa: Capabilities = { c2pa: async () => null, lm: null };
const enc = (s: string) => new TextEncoder().encode(s);
const dataJpeg = (extra: string) =>
  `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, ...enc(extra)]).toString('base64')}`;
const AI_XMP = '<x:xmpmeta>digitalsourcetype/trainedAlgorithmicMedia</x:xmpmeta>';

describe('check tools', () => {
  it('puts the scam warning and advice first', async () => {
    const r = await checkTextTool(
      {
        text: 'This is the IRS. Pay the fine today with Google Play gift cards and read me the codes. Do not tell your family.',
      },
      noC2pa,
    );
    expect(r.scam?.risk).toBe('high');
    expect(r.scam?.advice.length).toBeGreaterThan(0);
    expect(r.summary[0]).toMatch(/^Scam check: Warning/);
    expect(r.items[0]).toMatchObject({
      kind: 'text',
      outcome: 'not_assessed',
      title: 'Not checked',
    });
    expect(r.how_to_report).toMatch(/Never say content is "real"/);
  });

  it('checks images from data links and numbers them in the summary', async () => {
    const r = await checkPageTool(
      {
        page_url: 'https://example.com/post',
        images: [{ url: dataJpeg(AI_XMP) }, { url: dataJpeg('') }],
      },
      noC2pa,
    );
    expect(r.items.map((i) => i.outcome)).toEqual(['verified_ai', 'no_clear_signs']);
    expect(r.summary.filter((l) => /^Image \d/.test(l)).map((l) => l.slice(0, 7))).toEqual([
      'Image 1',
      'Image 2',
    ]);
    expect(r.items[0]!.note).toMatch(/Content Credentials could not be checked/);
    expect(r.checks_available).toEqual({
      content_credentials: false,
      picture_model: false,
      video_frames: false,
      deep_text_check: false,
    });
  });

  it('still uses a platform label when the image cannot be fetched', async () => {
    const r = await checkImageTool(
      {
        url: 'http://127.0.0.1/x.jpg',
        nearby_labels: ['AI info'],
        page_url: 'https://www.instagram.com/p/1',
      },
      noC2pa,
    );
    expect(r.items[0]).toMatchObject({
      outcome: 'verified_ai',
      reasons: [{ code: 'platform_label_ai' }],
    });
    expect(r.items[0]!.note).toMatch(/private or local network/);
  });

  it('reports a page-level platform label', async () => {
    const r = await checkPageTool(
      {
        page_url: 'https://www.youtube.com/watch?v=1',
        page_labels: ['Altered or synthetic content'],
      },
      noC2pa,
    );
    expect(r.items).toEqual([expect.objectContaining({ kind: 'page', outcome: 'verified_ai' })]);
  });

  it('never tells the user that content is real, human or safe', async () => {
    const r = await checkPageTool(
      {
        page_url: 'https://example.com',
        text: 'Preheat the oven and bake for 35 minutes.',
        images: [{ url: dataJpeg('') }],
      },
      noC2pa,
    );
    expect(r.summary.join('\n')).not.toMatch(/\b(is|looks) (real|human|genuine|safe)\b/i);
  });
});

/**
 * A stand-in video check: frames are flat colours, the "picture model" reads the red channel and
 * the "gate" the green one, so the tests control exactly what the frames look like.
 */
const flat = (red: number, green = 255): Pixels => {
  const data = new Uint8ClampedArray(200 * 200 * 4);
  for (let i = 0; i < 200 * 200; i++) data.set([red, green, 0, 255], i * 4);
  return { width: 200, height: 200, data };
};
const mean = (t: Float32Array, channel: number, size: number) => {
  let sum = 0;
  for (let i = 0; i < size * size; i++) sum += t[channel * size * size + i]!;
  return sum / (size * size);
};
const spec: PreprocessSpec = { resizeShortEdge: 32, cropSize: 32, mean: [0, 0, 0], std: [1, 1, 1] };
const frameCheck: VideoFrameCheck = {
  gate: {
    runner: { id: 'g', run: async (t, n) => Float32Array.of(mean(t, 0, n), mean(t, 1, n)) },
    model: {
      id: 'gate.test@1',
      preprocess: spec,
      logistic: { features: ['r', 'g'], mean: [0, 0], std: [1, 1], weights: [0, 20], bias: -5 },
      runnerId: 'g',
      file: '',
      url: '',
      sha256: '',
      bytes: 0,
      license: '',
      threshold: 0.5,
      trainedOn: '',
    },
  },
  runner: { id: 'r', run: async (t, n) => mean(t, 0, n) },
  imageModel: {
    ...spec,
    id: 'image.test@1',
    runnerId: 'r',
    file: '',
    url: '',
    sha256: '',
    bytes: 0,
    license: '',
    minSide: 128,
    calibration: [0],
    trainedOn: '',
    calibratedOn: '',
  },
  model: {
    id: 'video.frames.test@1',
    imageModelId: 'image.test@1',
    gateId: 'gate.test@1',
    frames: 6,
    minChecked: 4,
    calibration: Array.from({ length: 99 }, (_, i) => i / 200),
    calibrationWatched: Array.from({ length: 99 }, (_, i) => i / 200),
    calibratedOn: 'synthetic',
  },
};
const here = dirname(fileURLToPath(import.meta.url));
const clip = join(here, '..', '..', 'video-node', 'test', 'fixtures', 'testsrc.mp4');
const signedClip = join(here, '..', '..', 'c2pa-node', 'test', 'fixtures', 'ai-declared.mp4');

describe('check_video', () => {
  const withFrames = (frames: Pixels[], log: string[] = []): Capabilities => {
    const video: VideoCheck = {
      frameCheck,
      extractFrames: async (file, count) => (log.push(`extract ${count} from ${file}`), frames),
    };
    return { ...noC2pa, videoCheck: async () => video };
  };
  const six = (red: number, green = 255) => new Array<Pixels>(6).fill(flat(red, green));

  it('judges the frames of an unlabelled video file and says the check is experimental', async () => {
    const log: string[] = [];
    const r = await checkVideoTool({ path: clip }, withFrames(six(204), log));
    expect(r.items[0]).toMatchObject({
      kind: 'video',
      outcome: 'likely_ai',
      title: 'Likely made with AI',
      reasons: [{ code: 'video_frames_ai' }],
      evidence: { frames: 6, framesChecked: 6 },
    });
    expect(r.items[0]!.note).toMatch(/experimental/);
    expect(log).toEqual([`extract 6 from ${clip}`]);
    expect(r.summary[0]).toMatch(/^Video 1: Likely made with AI/);
    expect(r.checks_available.video_frames).toBe(true);
    const calm = await checkVideoTool({ path: clip }, withFrames(six(10)));
    expect(calm.items[0]).toMatchObject({ outcome: 'no_clear_signs', reasons: [] });
  });

  it('does not look at frames when the file carries an AI label', async () => {
    const log: string[] = [];
    // Without the Content Credentials library the signed fixture has nothing readable, so use
    // a site label to stand for "declared".
    const r = await checkVideoTool(
      { path: signedClip, nearby_labels: ['AI-generated'], page_url: 'https://www.tiktok.com/@a' },
      withFrames(six(204), log),
    );
    expect(r.items[0]).toMatchObject({
      outcome: 'verified_ai',
      reasons: [{ code: 'platform_label_ai' }],
    });
    expect(log).toEqual([]);
  });

  it('explains streamed video, and still uses a label shown next to it', async () => {
    const stream = { url: 'blob:https://www.youtube.com/abc' };
    const r = await checkVideoTool(stream, withFrames(six(204)));
    expect(r.items[0]).toMatchObject({ kind: 'video', outcome: 'not_assessed' });
    expect(r.items[0]!.note).toMatch(/streamed in pieces/);
    const labelled = await checkVideoTool(
      {
        ...stream,
        nearby_labels: ['Altered or synthetic content'],
        page_url: 'https://www.youtube.com/watch?v=1',
      },
      withFrames(six(204)),
    );
    expect(labelled.items[0]!.outcome).toBe('verified_ai');
  });

  it('does not judge a streamed video: there is no file, and screenshots are not accepted', async () => {
    const log: string[] = [];
    const r = await checkVideoTool(
      { url: 'blob:https://example.com/abc' },
      withFrames([flat(204)], log),
    );
    expect(log).toEqual([]);
    expect(r.items[0]).toMatchObject({ kind: 'video', outcome: 'not_assessed' });
    expect(r.items[0]!.note).toMatch(/streamed in pieces/);
  });

  it('says so when frames cannot be checked on this computer', async () => {
    const r = await checkVideoTool({ path: clip }, noC2pa);
    expect(r.items[0]).toMatchObject({ kind: 'video', outcome: 'no_clear_signs' });
    expect(r.items[0]!.note).toMatch(/frames of the video were not checked/);
    expect(r.checks_available.video_frames).toBe(false);
    const graphics = await checkVideoTool({ path: clip }, withFrames(six(250, 0)));
    expect(graphics.items[0]).toMatchObject({
      outcome: 'no_clear_signs',
      reasons: [{ code: 'video_not_plain_footage' }],
    });
    const unreadable = await checkVideoTool({ path: clip }, withFrames([]));
    expect(unreadable.items[0]!.reasons).toEqual([
      { code: 'unreadable_media', text: 'We could not read this item.' },
    ]);
  });

  it('checks videos as part of a page, a few at most', async () => {
    const videos = new Array(MAX_VIDEOS + 3).fill({ path: clip });
    const r = await checkPageTool({ text: 'Hello there.', videos }, withFrames(six(10)));
    expect(r.items.filter((i) => i.kind === 'video')).toHaveLength(MAX_VIDEOS);
    expect(r.summary.at(-1)).toMatch(/3 more videos were not checked/);
  });
});
