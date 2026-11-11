import {
  ENGINE_VERSION,
  VIDEO_FRAMES_MODEL,
  analyzeScam,
  checkImage,
  checkVideo,
  detectTextStats,
  itemFromVerdict,
  matchPlatformLabels,
  resolveOutcome,
  scamFromReport,
  type C2paReader,
  type ImageStatisticalCheck,
  type PageReport,
  type Pixels,
  type ReasonCode,
  type VideoFrameCheck,
} from '@isitreal/core';
import type { PageData, PanelItem, PanelResult } from '../messages.js';
import { STRINGS } from '../strings.js';

/** Images checked per page, largest first. */
export const MAX_IMAGES = 12;
/** Videos checked per page, largest first. */
export const MAX_VIDEOS = 2;

/** What the host (the hidden extension page) provides. Each check is skipped when its part is missing. */
export interface EngineCapabilities {
  /** The image file as the site serves it. Throws when it cannot be loaded. */
  fetchBytes(url: string): Promise<Uint8Array>;
  /** Content Credentials reader, or null when it could not be loaded. */
  c2pa: () => Promise<C2paReader | null>;
  /** Picture model and photo gate, or null when not downloaded yet. */
  imageCheck: () => Promise<ImageStatisticalCheck | null>;
  /** A small copy of the picture to show next to its result. */
  thumbnail?: (bytes: Uint8Array) => Promise<string | null>;
  /** The video file as the site serves it, when it is one file. Throws when it cannot be loaded. */
  fetchVideo?: (url: string) => Promise<Uint8Array>;
  /** Still frames spread evenly over a video file; empty when the file cannot be played. */
  videoFrames?: (bytes: Uint8Array, count: number) => Promise<Pixels[]>;
  onProgress?: (done: number, total: number) => void;
}

const hostOf = (url: string): string | undefined => {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.hostname : undefined;
  } catch {
    return undefined;
  }
};

async function checkOneImage(
  ref: PageData['images'][number],
  hostname: string | undefined,
  caps: EngineCapabilities,
): Promise<PanelItem> {
  const where = hostname === undefined ? {} : { hostname };
  let bytes: Uint8Array;
  try {
    bytes = await caps.fetchBytes(ref.url);
  } catch {
    // A label the site shows next to the image still counts when the file cannot be read.
    const fromLabels = await checkImage(
      { bytes: new Uint8Array(0), nearbyLabels: ref.labels },
      where,
    );
    return itemFromVerdict(fromLabels, ref.url, STRINGS.noteImageUnreadable);
  }
  const c2pa = await caps.c2pa();
  const statistical = await caps.imageCheck();
  const verdict = await checkImage(
    { bytes, nearbyLabels: ref.labels },
    {
      ...where,
      ...(c2pa === null ? {} : { c2pa }),
      ...(statistical === null ? {} : { statistical }),
    },
  );
  const preview = (await caps.thumbnail?.(bytes)) ?? null;
  return { ...itemFromVerdict(verdict, ref.url), ...(preview === null ? {} : { preview }) };
}

/** Checks one picture the person pointed at (right-click). */
export async function checkPicture(
  url: string,
  pageUrl: string,
  caps: EngineCapabilities,
): Promise<{ item: PanelItem; checks: PanelResult['checks'] }> {
  return {
    item: await checkOneImage({ url, labels: [] }, hostOf(pageUrl), caps),
    checks: {
      contentCredentials: (await caps.c2pa()) !== null,
      pictureModel: (await caps.imageCheck()) !== null,
    },
  };
}

/**
 * The experimental video frame check: the picture check plus its calibration on real video.
 * Null when the picture check is not set up, or when the calibration belongs to other models.
 */
export async function videoFrameCheck(caps: EngineCapabilities): Promise<VideoFrameCheck | null> {
  const image = await caps.imageCheck();
  const model = VIDEO_FRAMES_MODEL;
  if (image === null || model.calibration.length === 0) return null;
  if (image.model.id !== model.imageModelId || image.gate.model.id !== model.gateId) return null;
  return { gate: image.gate, runner: image.runner, imageModel: image.model, model };
}

/** A video address that can be fetched as one file (not a stream delivered in pieces). */
const isFileUrl = (url: string | undefined): url is string =>
  url !== undefined && /^https?:/i.test(url) && !/\.(m3u8|mpd)(\?|#|$)/i.test(url);

async function checkOneVideo(
  ref: PageData['videos'][number],
  hostname: string | undefined,
  caps: EngineCapabilities,
): Promise<PanelItem> {
  const source = ref.url ?? STRINGS.sourceStream;
  const notes: string[] = [];
  let bytes: Uint8Array | null = null;
  if (isFileUrl(ref.url) && caps.fetchVideo !== undefined) {
    try {
      bytes = await caps.fetchVideo(ref.url);
    } catch {
      notes.push(STRINGS.noteVideoUnreadable);
    }
  } else notes.push(STRINGS.noteVideoStreamed);
  const c2pa = await caps.c2pa();
  const frameCheck = await videoFrameCheck(caps);
  const file = bytes;
  const frames =
    frameCheck !== null && file !== null && caps.videoFrames !== undefined
      ? async () => {
          const got = await caps.videoFrames!(file, frameCheck.model.frames);
          return got.length > 0 ? got : null;
        }
      : undefined;
  const verdict = await checkVideo(
    {
      ...(file === null ? {} : { bytes: file }),
      ...(frames === undefined ? {} : { frames }),
      nearbyLabels: ref.labels,
    },
    {
      ...(hostname === undefined ? {} : { hostname }),
      ...(c2pa === null ? {} : { c2pa }),
      ...(frameCheck === null ? {} : { frameCheck }),
    },
  );
  if (file !== null && frameCheck === null) notes.push(STRINGS.noteVideoNoFrames);
  if (verdict.signals.some((s) => s.kind === 'statistical') || frames !== undefined)
    notes.push(STRINGS.noteVideoExperimental);
  // Frames not looked at, and nothing declared: the panel offers to watch the video as it plays.
  const watch = frames === undefined && verdict.outcome !== 'verified_ai';
  return {
    ...itemFromVerdict(verdict, source, notes.length > 0 ? notes.join(' ') : undefined),
    ...(watch ? { watch: { frameId: ref.frameId, index: ref.index, labels: ref.labels } } : {}),
  };
}

/**
 * Judges frames that were read from a video while it played in the page (streamed video has no
 * file to fetch). Labels shown next to the video still count first.
 */
export async function checkVideoFrames(
  frames: readonly Pixels[],
  labels: string[],
  pageUrl: string,
  caps: EngineCapabilities,
): Promise<PanelItem> {
  const hostname = hostOf(pageUrl);
  const frameCheck = await videoFrameCheck(caps);
  const verdict = await checkVideo(
    {
      ...(frameCheck === null ? {} : { frames: async () => (frames.length > 0 ? frames : null) }),
      nearbyLabels: labels,
    },
    {
      ...(hostname === undefined ? {} : { hostname }),
      ...(frameCheck === null ? {} : { frameCheck }),
    },
  );
  const notes = [
    frameCheck === null ? STRINGS.noteVideoNoFrames : STRINGS.noteVideoWatched,
    ...(frameCheck === null ? [] : [STRINGS.noteVideoExperimental]),
  ];
  return itemFromVerdict(verdict, STRINGS.sourceStream, notes.join(' '));
}

/**
 * Checks one page: scam warning signs first (ADR-0007), then the text, each image and the site's
 * own AI labels. The same core and the same wording as the Claude plugin.
 */
export async function checkPageData(
  page: PageData,
  caps: EngineCapabilities,
): Promise<PanelResult> {
  const hostname = hostOf(page.url);
  const scamReport = analyzeScam({
    text: page.text,
    ...(hostname === undefined ? {} : { pageHost: hostname }),
    links: page.links,
  });
  const report: PageReport = {
    scamRisk: scamReport.risk,
    scamReasons: scamReport.reasons,
    items: [],
    engine: ENGINE_VERSION,
  };
  const evidence = new Map<ReasonCode, string>(
    scamReport.hits.map((h) => [h.reason, h.evidence] as [ReasonCode, string]),
  );

  const images = page.images.slice(0, MAX_IMAGES);
  const videos = page.videos.slice(0, MAX_VIDEOS);
  const total = images.length + videos.length + 1;
  let done = 0;
  const step = () => caps.onProgress?.(++done, total);

  const items: PanelItem[] = [];
  if (page.text.trim().length > 0)
    items.push(
      itemFromVerdict(resolveOutcome('text', [detectTextStats(page.text)]), STRINGS.sourceText),
    );
  step();
  for (const ref of images) {
    items.push(await checkOneImage(ref, hostname, caps));
    step();
  }
  for (const ref of videos) {
    items.push(await checkOneVideo(ref, hostname, caps));
    step();
  }
  if (hostname !== undefined && page.pageLabels.length > 0) {
    const hits = matchPlatformLabels(hostname, page.pageLabels);
    if (hits.length > 0)
      items.push(
        itemFromVerdict(
          resolveOutcome('page', [
            {
              status: 'assessed',
              signal: {
                detector: 'page.platform-label',
                modality: 'page',
                kind: 'platform_label',
                score: 1,
                reasons: ['platform_label_ai'],
                details: { platform: hits[0]!.platform, label: hits[0]!.text },
              },
            },
          ]),
          STRINGS.sourcePageLabel,
        ),
      );
  }
  return {
    url: page.url,
    scam: scamFromReport(report, evidence),
    items,
    checks: {
      contentCredentials: (await caps.c2pa()) !== null,
      pictureModel: (await caps.imageCheck()) !== null,
    },
    notChecked: Math.max(0, page.images.length - MAX_IMAGES) + page.skippedImages,
    engine: ENGINE_VERSION,
  };
}
