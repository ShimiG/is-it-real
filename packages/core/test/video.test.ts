import { describe, expect, it } from 'vitest';
import {
  checkVideo,
  checkVideoProvenance,
  detectVideoFormat,
  detectVideoFrames,
  median,
  type C2paReader,
  type ImageClassifierModel,
  type PhotoGateModel,
  type Pixels,
  type VideoFrameCheck,
  type VideoFramesModel,
} from '../src/index.js';

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(
    parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)),
  );
const MP4 = bytes([0, 0, 0, 24], 'ftypisom', [0, 0, 2, 0], 'isomiso2', 'rest of the file');
const AI_XMP = '<x:xmpmeta>digitalsourcetype/trainedAlgorithmicMedia</x:xmpmeta>';

describe('detectVideoFormat', () => {
  it('recognises MP4, QuickTime and WebM / Matroska from the first bytes', () => {
    expect(detectVideoFormat(MP4)).toBe('mp4');
    expect(detectVideoFormat(bytes([0, 0, 0, 20], 'ftypqt  ', [0, 0, 0, 0]))).toBe('mov');
    expect(detectVideoFormat(bytes([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4]))).toBe('webm');
  });

  it('does not take still images, playlists or short files for video', () => {
    expect(detectVideoFormat(bytes([0, 0, 0, 28], 'ftypavif', [0, 0, 0, 0]))).toBe('unknown');
    expect(detectVideoFormat(bytes([0, 0, 0, 28], 'ftypheic', [0, 0, 0, 0]))).toBe('unknown');
    expect(detectVideoFormat(bytes('#EXTM3U\n#EXT-X-VERSION:3\n'))).toBe('unknown');
    expect(detectVideoFormat(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe('unknown');
    expect(detectVideoFormat(new Uint8Array(3))).toBe('unknown');
  });
});

describe('checkVideoProvenance', () => {
  it('says "not checked" for something that is not a video file', async () => {
    const v = await checkVideoProvenance(bytes('hello'));
    expect(v).toMatchObject({
      modality: 'video',
      outcome: 'not_assessed',
      reasons: ['unreadable_media'],
    });
  });

  it('finds no clear signs in a plain video, and an unsigned AI label when there is one', async () => {
    expect(await checkVideoProvenance(MP4)).toMatchObject({
      modality: 'video',
      outcome: 'no_clear_signs',
      reasons: [],
    });
    expect(await checkVideoProvenance(bytes([...MP4], AI_XMP))).toMatchObject({
      outcome: 'verified_ai',
      reasons: ['iptc_trained_algorithmic_media'],
    });
  });

  it('asks the Content Credentials reader with the right media type, and survives its failure', async () => {
    const seen: string[] = [];
    const reader: C2paReader = {
      read: async (_b, mime) => {
        seen.push(mime);
        return {
          active_manifest: 'm',
          manifests: {
            m: {
              claim_generator_info: [{ name: 'Sora' }],
              signature_info: { issuer: 'OpenAI' },
              assertions: [
                {
                  label: 'c2pa.actions.v2',
                  data: {
                    actions: [
                      {
                        action: 'c2pa.created',
                        digitalSourceType:
                          'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia',
                      },
                    ],
                  },
                },
              ],
            },
          },
          validation_state: 'Trusted',
        };
      },
    };
    const v = await checkVideoProvenance(MP4, reader);
    expect(seen).toEqual(['video/mp4']);
    expect(v).toMatchObject({ outcome: 'verified_ai', reasons: ['c2pa_declares_ai'] });
    expect(v.signals.find((s) => s.detector.startsWith('video.c2pa'))).toMatchObject({
      modality: 'video',
      details: { issuer: 'OpenAI', generators: 'Sora' },
    });
    // WebM cannot carry Content Credentials the reader understands: it is not asked.
    await checkVideoProvenance(bytes([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]), reader);
    expect(seen).toEqual(['video/mp4']);
    const broken: C2paReader = {
      read: async () => {
        throw new Error('native library crashed');
      },
    };
    expect(await checkVideoProvenance(MP4, broken)).toMatchObject({ outcome: 'no_clear_signs' });
  });
});

/** A frame whose red channel carries the "picture model score" and green the "photo-likeness". */
const frame = (score: number, photo = true, size = 200): Pixels => {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) data.set([score, photo ? 255 : 0, 0, 255], i * 4);
  return { width: size, height: size, data };
};
const spec = { resizeShortEdge: 32, cropSize: 32, mean: [0, 0, 0], std: [1, 1, 1] } as const;
const imageModel: ImageClassifierModel = {
  ...spec,
  mean: [0, 0, 0],
  std: [1, 1, 1],
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
};
const gateModel: PhotoGateModel = {
  id: 'gate.test@1',
  preprocess: { ...spec, mean: [0, 0, 0], std: [1, 1, 1] },
  // Embedding = (mean red, mean green); photo-like when green is high.
  logistic: { features: ['r', 'g'], mean: [0, 0], std: [1, 1], weights: [0, 20], bias: -5 },
  runnerId: 'g',
  file: '',
  url: '',
  sha256: '',
  bytes: 0,
  license: '',
  threshold: 0.5,
  trainedOn: '',
};
const meanOf = (t: Float32Array, channel: number, size: number) => {
  let sum = 0;
  for (let i = 0; i < size * size; i++) sum += t[channel * size * size + i]!;
  return sum / (size * size);
};
const videoModel: VideoFramesModel = {
  id: 'video.frames.test@1',
  imageModelId: 'image.test@1',
  gateId: 'gate.test@1',
  frames: 6,
  minChecked: 4,
  // 99 real videos whose middle frame score was 0.00 .. 0.49.
  calibration: Array.from({ length: 99 }, (_, i) => i / 200),
  // Watched video: real videos reach higher numbers (0.00 .. 0.98).
  calibrationWatched: Array.from({ length: 99 }, (_, i) => i / 100),
  calibratedOn: 'synthetic',
};
let classifierRuns = 0;
const check: VideoFrameCheck = {
  gate: {
    model: gateModel,
    runner: { id: 'g', run: async (t, s) => Float32Array.of(meanOf(t, 0, s), meanOf(t, 1, s)) },
  },
  runner: { id: 'r', run: async (t, s) => (classifierRuns++, meanOf(t, 0, s)) },
  imageModel,
  model: videoModel,
};

describe('detectVideoFrames', () => {
  it('takes the middle of the frame scores', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('flags a video whose frames mostly score above real videos', async () => {
    // Scores 0.8 (red 204): above all 99 calibration videos.
    const r = await detectVideoFrames(new Array(6).fill(frame(204)), check);
    expect(r).toMatchObject({
      status: 'assessed',
      signal: {
        modality: 'video',
        kind: 'statistical',
        reasons: ['video_frames_ai'],
        details: { frames: 6, framesChecked: 6 },
      },
    });
    if (r.status === 'assessed') expect(r.signal.score).toBeCloseTo(0.99, 6);
  });

  it('is not moved by one or two odd frames', async () => {
    const frames = [frame(250), frame(250), frame(10), frame(10), frame(10), frame(10)];
    const r = await detectVideoFrames(frames, check);
    if (r.status !== 'assessed') throw new Error('expected a score');
    expect(r.signal.score).toBeLessThan(0.2);
  });

  it('leaves out frames that are not plain pictures, and gives up when too few are left', async () => {
    classifierRuns = 0;
    const mostlyGraphics = [
      frame(250),
      frame(250),
      frame(250),
      ...new Array(3).fill(frame(250, false)),
    ];
    expect(await detectVideoFrames(mostlyGraphics, check)).toEqual({
      status: 'not_assessed',
      detector: 'video.frames.test@1',
      reason: 'video_not_plain_footage',
    });
    expect(classifierRuns).toBe(3); // the picture model never saw the three graphic frames
    const enough = [...new Array(4).fill(frame(10)), frame(250, false), frame(250, false)];
    expect(await detectVideoFrames(enough, check)).toMatchObject({
      status: 'assessed',
      signal: { details: { frames: 6, framesChecked: 4 } },
    });
  });

  it('does not judge tiny or missing frames', async () => {
    expect(await detectVideoFrames([], check)).toMatchObject({ reason: 'unreadable_media' });
    expect(await detectVideoFrames(new Array(6).fill(frame(250, true, 64)), check)).toMatchObject({
      reason: 'too_short',
    });
  });

  it('judges a watched video against its own, stricter calibration', async () => {
    // Frames scoring 0.8 are above every real video file, but not above every watched one.
    const frames = Array.from({ length: 6 }, () => frame(204));
    const spread = await detectVideoFrames(frames, check);
    const watched = await detectVideoFrames(frames, check, 'watched');
    expect(spread.status === 'assessed' && spread.signal.score).toBeGreaterThanOrEqual(0.99);
    expect(watched.status === 'assessed' && watched.signal.score).toBeLessThan(0.99);
    expect(watched.status === 'assessed' && watched.signal.details).toMatchObject({
      sampling: 'watched',
    });
    await expect(
      detectVideoFrames(
        frames,
        { ...check, model: { ...videoModel, calibrationWatched: [] } },
        'watched',
      ),
    ).rejects.toThrow(/no numbers for watched/);
  });

  it('refuses a calibration made for a different picture model or gate', async () => {
    const other = { ...check, model: { ...videoModel, imageModelId: 'image.other@1' } };
    await expect(detectVideoFrames([frame(1)], other)).rejects.toThrow(/belongs to image.other@1/);
    const wrongRunner = { ...check, runner: { ...check.runner, id: 'x' } };
    await expect(detectVideoFrames([frame(1)], wrongRunner)).rejects.toThrow(/belongs to r/);
  });
});

describe('checkVideo', () => {
  const frames = (score: number) => async () => new Array<Pixels>(6).fill(frame(score));

  it('says "Likely made with AI" from the frames when the file declares nothing', async () => {
    const v = await checkVideo({ bytes: MP4, frames: frames(204) }, { frameCheck: check });
    expect(v).toMatchObject({
      modality: 'video',
      outcome: 'likely_ai',
      reasons: ['video_frames_ai'],
    });
  });

  it('does not read frames when the file or the site already declares AI', async () => {
    let asked = 0;
    const counting = async () => (asked++, new Array<Pixels>(6).fill(frame(204)));
    const declared = await checkVideo(
      { bytes: bytes([...MP4], AI_XMP), frames: counting },
      { frameCheck: check },
    );
    expect(declared.outcome).toBe('verified_ai');
    const labelled = await checkVideo(
      { bytes: MP4, frames: counting, nearbyLabels: ['AI-generated'] },
      { frameCheck: check, hostname: 'www.tiktok.com' },
    );
    expect(labelled).toMatchObject({ outcome: 'verified_ai', reasons: ['platform_label_ai'] });
    expect(asked).toBe(0);
  });

  it('keeps the provenance result and says why when frames cannot be judged', async () => {
    const noFrames = await checkVideo(
      { bytes: MP4, frames: async () => null },
      { frameCheck: check },
    );
    expect(noFrames).toMatchObject({ outcome: 'no_clear_signs', reasons: ['unreadable_media'] });
    const graphics = await checkVideo(
      { bytes: MP4, frames: async () => new Array<Pixels>(6).fill(frame(250, false)) },
      { frameCheck: check },
    );
    expect(graphics).toMatchObject({
      outcome: 'no_clear_signs',
      reasons: ['video_not_plain_footage'],
    });
  });

  it('works from frames alone (screenshots) and from a label alone', async () => {
    const shots = await checkVideo({ frames: frames(204) }, { frameCheck: check });
    expect(shots.outcome).toBe('likely_ai');
    const calm = await checkVideo({ frames: frames(10) }, { frameCheck: check });
    expect(calm).toMatchObject({ outcome: 'no_clear_signs', reasons: [] });
    const label = await checkVideo(
      { nearbyLabels: ['Altered or synthetic content'] },
      { hostname: 'www.youtube.com' },
    );
    expect(label.outcome).toBe('verified_ai');
    expect(await checkVideo({})).toMatchObject({ outcome: 'not_assessed' });
  });
});
