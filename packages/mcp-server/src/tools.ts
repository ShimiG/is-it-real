import {
  ENGINE_VERSION,
  analyzeScam,
  checkImage,
  checkVideo,
  detectTextDeep,
  detectTextStats,
  matchPlatformLabels,
  resolveOutcome,
  type C2paReader,
  type ImageStatisticalCheck,
  type LanguageModel,
  type PageReport,
  type Pixels,
  type ReasonCode,
  type Verdict,
  type VideoFrameCheck,
} from '@isitreal/core';
import {
  HOW_TO_REPORT,
  itemFromVerdict,
  scamFromReport,
  summaryLines,
  type ItemResult,
  type ToolResult,
} from './format.js';
import {
  MediaError,
  loadFromPath,
  loadFromUrl,
  loadVideo,
  type LoadedVideo,
  type MediaOptions,
} from './media.js';

/** What the server could load. Each check degrades gracefully when its part is missing. */
export interface Capabilities {
  /** Content Credentials reader; loaded lazily because it may still be installing. */
  c2pa: () => Promise<C2paReader | null>;
  lm: LanguageModel | null;
  /** Picture check (image classifier); loaded lazily because it may still be setting up. */
  imageCheck?: () => Promise<ImageStatisticalCheck | null>;
  /** Experimental video frame check; needs the picture check and ffmpeg. */
  videoCheck?: () => Promise<VideoCheck | null>;
  media?: MediaOptions;
}

/** What the server needs to judge a video's frames. */
export interface VideoCheck {
  frameCheck: VideoFrameCheck;
  /** Frames spread evenly over a video file; empty when the file cannot be read. */
  extractFrames: (file: string, count: number) => Promise<Pixels[]>;
  /** Decodes a saved screenshot (the fallback when the video file cannot be fetched). */
  decodeImage: (bytes: Uint8Array) => Promise<Pixels | null>;
}

export interface ImageRef {
  url?: string | undefined;
  path?: string | undefined;
  nearby_labels?: string[] | undefined;
}

export interface VideoRef {
  url?: string | undefined;
  path?: string | undefined;
  /** Saved screenshots of the playing video, for video that cannot be fetched as a file. */
  frame_paths?: string[] | undefined;
  nearby_labels?: string[] | undefined;
}

export interface PageArgs {
  page_url?: string | undefined;
  text?: string | undefined;
  links?: { text: string; href: string }[] | undefined;
  images?: ImageRef[] | undefined;
  videos?: VideoRef[] | undefined;
  page_labels?: string[] | undefined;
}

export const MAX_IMAGES = 12;
export const MAX_VIDEOS = 2;
export const MAX_FRAME_SCREENSHOTS = 12;

async function available(caps: Capabilities): Promise<ToolResult['checks_available']> {
  return {
    content_credentials: (await caps.c2pa()) !== null,
    picture_model: ((await caps.imageCheck?.()) ?? null) !== null,
    video_frames: ((await caps.videoCheck?.()) ?? null) !== null,
    deep_text_check: caps.lm !== null,
  };
}

const hostOf = (url: string | undefined): string | undefined => {
  if (url === undefined) return undefined;
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
};

async function checkOneImage(
  ref: ImageRef,
  hostname: string | undefined,
  caps: Capabilities,
): Promise<ItemResult> {
  const source = ref.url ?? ref.path ?? '(no source)';
  const labels = ref.nearby_labels ?? [];
  let bytes: Uint8Array;
  try {
    if (ref.url !== undefined) bytes = await loadFromUrl(ref.url, caps.media);
    else if (ref.path !== undefined) bytes = await loadFromPath(ref.path);
    else throw new MediaError('Give an image link or a file path.', 'unreadable');
  } catch (err) {
    const note = err instanceof MediaError ? err.message : 'The image could not be loaded.';
    // A platform label next to the image still counts even when the file cannot be read.
    const fromLabels = await checkImage(
      { bytes: new Uint8Array(0), nearbyLabels: labels },
      hostname === undefined ? {} : { hostname },
    );
    return itemFromVerdict(fromLabels, source, `Could not read the image file: ${note}`);
  }
  const c2pa = await caps.c2pa();
  const statistical = (await caps.imageCheck?.()) ?? null;
  const verdict = await checkImage(
    { bytes, nearbyLabels: labels },
    {
      ...(hostname === undefined ? {} : { hostname }),
      ...(c2pa === null ? {} : { c2pa }),
      ...(statistical === null ? {} : { statistical }),
    },
  );
  const notes = [
    ...(c2pa === null
      ? ['Content Credentials could not be checked on this computer; file metadata was checked.']
      : []),
    ...(statistical === null
      ? [
          'The picture-checking model was not available, so only labels and signatures were checked.',
        ]
      : []),
  ];
  return itemFromVerdict(verdict, source, notes.length > 0 ? notes.join(' ') : undefined);
}

const EXPERIMENTAL_NOTE =
  'The frame check for video is experimental: it looks at a few still frames and catches only some AI video.';

async function checkOneVideo(
  ref: VideoRef,
  hostname: string | undefined,
  caps: Capabilities,
): Promise<ItemResult> {
  const source = ref.url ?? ref.path ?? (ref.frame_paths?.length ? 'screenshots' : '(no source)');
  const labels = ref.nearby_labels ?? [];
  const notes: string[] = [];
  let loaded: LoadedVideo | null = null;
  if (ref.url !== undefined || ref.path !== undefined) {
    try {
      loaded = await loadVideo(ref, caps.media);
    } catch (err) {
      const why = err instanceof MediaError ? err.message : 'The video could not be loaded.';
      notes.push(`Could not read the video file: ${why}`);
    }
  }
  try {
    const c2pa = await caps.c2pa();
    const video = (await caps.videoCheck?.()) ?? null;
    const shots = (ref.frame_paths ?? []).slice(0, MAX_FRAME_SCREENSHOTS);
    let frames: (() => Promise<Pixels[] | null>) | undefined;
    if (video !== null && loaded !== null) {
      const file = loaded.file;
      frames = async () => {
        const got = await video.extractFrames(file, video.frameCheck.model.frames);
        return got.length > 0 ? got : null;
      };
    } else if (video !== null && shots.length > 0) {
      frames = async () => {
        const got: Pixels[] = [];
        for (const path of shots) {
          try {
            const px = await video.decodeImage(await loadFromPath(path));
            if (px !== null) got.push(px);
          } catch {
            // An unreadable screenshot is skipped.
          }
        }
        return got.length > 0 ? got : null;
      };
      notes.push(
        'Frames came from screenshots, which lose detail and any labels in the file; treat the result with extra care.',
      );
    }
    const verdict = await checkVideo(
      {
        ...(loaded === null ? {} : { bytes: loaded.bytes }),
        ...(frames === undefined ? {} : { frames }),
        nearbyLabels: labels,
      },
      {
        ...(hostname === undefined ? {} : { hostname }),
        ...(c2pa === null ? {} : { c2pa }),
        ...(video === null ? {} : { frameCheck: video.frameCheck }),
      },
    );
    if (loaded !== null && c2pa === null)
      notes.push(
        'Content Credentials could not be checked on this computer; metadata was checked.',
      );
    if (video === null)
      notes.push(
        'The frames of the video were not checked (this needs the picture model and ffmpeg); only labels and signatures were.',
      );
    else if (verdict.signals.some((sig) => sig.kind === 'statistical') || frames !== undefined)
      notes.push(EXPERIMENTAL_NOTE);
    return itemFromVerdict(verdict, source, notes.length > 0 ? notes.join(' ') : undefined);
  } finally {
    await loaded?.cleanup();
  }
}

async function textVerdict(text: string, caps: Capabilities): Promise<Verdict> {
  if (caps.lm !== null) {
    try {
      return resolveOutcome('text', [await detectTextDeep(text, caps.lm)]);
    } catch {
      // Fall back to the statistics-only check below.
    }
  }
  return resolveOutcome('text', [detectTextStats(text)]);
}

/** Checks a whole page (or a message): scam risk, text, images and platform labels. */
export async function checkPageTool(args: PageArgs, caps: Capabilities): Promise<ToolResult> {
  const hostname = hostOf(args.page_url);
  const text = args.text ?? '';
  const scamReport = analyzeScam({
    text,
    ...(hostname === undefined ? {} : { pageHost: hostname }),
    ...(args.links === undefined ? {} : { links: args.links }),
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

  const items: ItemResult[] = [];
  if (text.trim().length > 0)
    items.push(itemFromVerdict(await textVerdict(text, caps), 'page text'));
  for (const ref of (args.images ?? []).slice(0, MAX_IMAGES))
    items.push(await checkOneImage(ref, hostname, caps));
  for (const ref of (args.videos ?? []).slice(0, MAX_VIDEOS))
    items.push(await checkOneVideo(ref, hostname, caps));
  if (hostname !== undefined && (args.page_labels?.length ?? 0) > 0) {
    const hits = matchPlatformLabels(hostname, args.page_labels!);
    if (hits.length > 0) {
      const v = resolveOutcome('page', [
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
      ]);
      items.push(itemFromVerdict(v, 'label shown on the page'));
    }
  }
  const skipped = (args.images?.length ?? 0) - MAX_IMAGES;
  const scam = scamFromReport(report, evidence);
  const summary = summaryLines(scam, items);
  if (skipped > 0)
    summary.push(`(${skipped} more images were not checked; at most ${MAX_IMAGES} per call.)`);
  const skippedVideos = (args.videos?.length ?? 0) - MAX_VIDEOS;
  if (skippedVideos > 0)
    summary.push(
      `(${skippedVideos} more videos were not checked; at most ${MAX_VIDEOS} per call.)`,
    );
  return {
    summary,
    scam,
    items,
    checks_available: await available(caps),
    how_to_report: HOW_TO_REPORT,
    engine: ENGINE_VERSION,
  };
}

export async function checkTextTool(
  args: { text: string; page_url?: string | undefined; links?: PageArgs['links'] },
  caps: Capabilities,
): Promise<ToolResult> {
  return checkPageTool({ text: args.text, page_url: args.page_url, links: args.links }, caps);
}

export async function checkImageTool(
  args: ImageRef & { page_url?: string | undefined },
  caps: Capabilities,
): Promise<ToolResult> {
  const hostname = hostOf(args.page_url);
  const item = await checkOneImage(args, hostname, caps);
  return {
    summary: summaryLines(null, [item]),
    scam: null,
    items: [item],
    checks_available: await available(caps),
    how_to_report: HOW_TO_REPORT,
    engine: ENGINE_VERSION,
  };
}

export async function checkVideoTool(
  args: VideoRef & { page_url?: string | undefined },
  caps: Capabilities,
): Promise<ToolResult> {
  const hostname = hostOf(args.page_url);
  const item = await checkOneVideo(args, hostname, caps);
  return {
    summary: summaryLines(null, [item]),
    scam: null,
    items: [item],
    checks_available: await available(caps),
    how_to_report: HOW_TO_REPORT,
    engine: ENGINE_VERSION,
  };
}
