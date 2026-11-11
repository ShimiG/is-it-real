import {
  IMAGE_CLASSIFIER_MODEL,
  PHOTO_GATE_MODEL,
  VIDEO_FRAMES_MODEL,
  photoLikeScore,
  preprocessForClassifier,
  yuv420ToPixels,
  type C2paReader,
  type ImageStatisticalCheck,
  type Pixels,
} from '@isitreal/core';
import { createWasmC2paReader } from '../engine/c2pa.js';
import {
  checkPageData,
  checkPicture,
  checkVideoFrames,
  type EngineCapabilities,
} from '../engine/check.js';
import { decodeImage, thumbnail } from '../engine/decode.js';
import { fetchImageBytes } from '../engine/media.js';
import { ModelStore } from '../engine/models.js';
import { configureRuntime, loadClassifier, loadEmbedder } from '../engine/ort.js';
import { fetchVideoBytes, framesFromVideoFile } from '../engine/video.js';
import { unpackFrame } from '../shared/raw-frame.js';
import {
  ENGINE_PORT,
  type EngineEvent,
  type EngineRequest,
  type PictureScore,
} from '../messages.js';

/**
 * The engine page: a hidden extension page that runs the checks. The side panel connects with a
 * port, sends a page, and gets progress and the result back. Everything runs here, on this
 * computer.
 */

/** Loaded on first use and kept. Null when it cannot be loaded; the panel then says so. */
let c2pa: Promise<C2paReader | null> | null = null;
const loadC2pa = () =>
  (c2pa ??= (async () => {
    try {
      const trust = await fetch(chrome.runtime.getURL('trust/C2PA-TRUST-LIST.pem'));
      return await createWasmC2paReader(chrome.runtime.getURL('c2pa.wasm'), {
        trustAnchorsPem: await trust.text(),
      });
    } catch (err) {
      console.error('Content Credentials reader could not be loaded', err);
      return null;
    }
  })());

// Worker threads need an isolated page (set in the manifest); without it, one thread.
configureRuntime(
  chrome.runtime.getURL('ort/'),
  self.crossOriginIsolated ? Math.max(1, Math.min(4, navigator.hardwareConcurrency ?? 1)) : 1,
);

// Note: this page can use chrome.runtime only (no storage, no tabs), so settings arrive in requests.
const models = new ModelStore([IMAGE_CLASSIFIER_MODEL, PHOTO_GATE_MODEL]);

/** The picture check: both model files loaded. Null until they have been downloaded. */
let imageCheck: Promise<ImageStatisticalCheck | null> | null = null;
const loadImageCheck = () =>
  (imageCheck ??= (async () => {
    try {
      const classifier = await models.read(IMAGE_CLASSIFIER_MODEL);
      const encoder = await models.read(PHOTO_GATE_MODEL);
      if (classifier === null || encoder === null) {
        // Not downloaded yet: ask again next time.
        imageCheck = null;
        return null;
      }
      return {
        decode: decodeImage,
        gate: {
          runner: await loadEmbedder(PHOTO_GATE_MODEL.runnerId, encoder),
          model: PHOTO_GATE_MODEL,
        },
        runner: await loadClassifier(IMAGE_CLASSIFIER_MODEL.runnerId, classifier),
        model: IMAGE_CLASSIFIER_MODEL,
      };
    } catch (err) {
      console.error('picture check could not be loaded', err);
      return null;
    }
  })());

/** More frames than the check uses are not kept. */
const MAX_WATCHED_FRAMES = 12;

const capabilities: Omit<EngineCapabilities, 'onProgress'> = {
  fetchBytes: fetchImageBytes,
  c2pa: loadC2pa,
  imageCheck: loadImageCheck,
  thumbnail,
  fetchVideo: fetchVideoBytes,
  videoFrames: async (bytes, count) =>
    (await framesFromVideoFile(bytes, count)).map((f) => f.pixels),
};

/** The two numbers behind a picture's verdict, without the verdict. */
async function scorePicture(url: string): Promise<PictureScore | null> {
  const check = await loadImageCheck();
  if (check === null) return null;
  const pixels = await decodeImage(await fetchImageBytes(url));
  if (pixels === null) return null;
  return {
    width: pixels.width,
    height: pixels.height,
    gate: await photoLikeScore(pixels, check.gate),
    raw: await check.runner.run(preprocessForClassifier(pixels, check.model), check.model.cropSize),
  };
}

/** The same two numbers for each sampled frame of a video file. */
async function scoreVideo(url: string): Promise<PictureScore[] | null> {
  const check = await loadImageCheck();
  if (check === null) return null;
  const problems: string[] = [];
  const frames = await framesFromVideoFile(
    await fetchVideoBytes(url),
    VIDEO_FRAMES_MODEL.frames,
    (what) => problems.push(what),
  );
  if (frames.length === 0) throw new Error(`no frames: ${problems.join('; ')}`);
  const scores: PictureScore[] = [];
  for (const { pixels, time } of frames)
    scores.push({
      width: pixels.width,
      height: pixels.height,
      gate: await photoLikeScore(pixels, check.gate),
      raw: await check.runner.run(
        preprocessForClassifier(pixels, check.model),
        check.model.cropSize,
      ),
      time,
    });
  return scores;
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== ENGINE_PORT) return;
  let open = true;
  port.onDisconnect.addListener(() => {
    open = false;
  });
  const send = (event: EngineEvent) => {
    if (open) port.postMessage(event);
  };
  const fail = (err: unknown) => send({ type: 'error', message: String(err) });
  /** Frames of a playing video, sent one by one before they are judged together. */
  let watched: Pixels[] = [];
  port.onMessage.addListener((request: EngineRequest) => {
    switch (request?.type) {
      case 'check-page':
        checkPageData(request.page, {
          ...capabilities,
          onProgress: (done, total) => send({ type: 'progress', done, total }),
        }).then((result) => send({ type: 'result', result }), fail);
        break;
      case 'check-picture':
        checkPicture(request.url, request.pageUrl, capabilities).then(
          ({ item, checks }) => send({ type: 'picture-result', item, checks }),
          fail,
        );
        break;
      case 'models-status':
        models.state().then((state) => send({ type: 'models', models: state }), fail);
        break;
      case 'install-models':
        models.clearFailure();
        models
          .install((state) => send({ type: 'models', models: state }), request.baseUrl)
          .then(() => {
            // Load the files that have just arrived on the next check.
            imageCheck = null;
          }, fail);
        break;
      case 'score-picture':
        scorePicture(request.url).then((score) => send({ type: 'score', score }), fail);
        break;
      case 'video-frame': {
        const raw = unpackFrame(request.frame);
        if (raw !== null && watched.length < MAX_WATCHED_FRAMES) watched.push(yuv420ToPixels(raw));
        break;
      }
      case 'check-video-frames': {
        const frames = watched;
        watched = [];
        checkVideoFrames(frames, request.labels, request.pageUrl, capabilities).then(
          (item) => send({ type: 'video-result', item }),
          fail,
        );
        break;
      }
      case 'score-video':
        scoreVideo(request.url).then((frames) => send({ type: 'video-score', frames }), fail);
        break;
    }
  });
});
