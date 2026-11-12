import { runImageStatisticalCheck, type ImageStatisticalCheck } from './image/classifier.js';
import { checkImageProvenance, type C2paReader } from './image/provenance.js';
import type { Pixels } from './image/spectral.js';
import { resolveOutcome } from './outcome.js';
import { matchPlatformLabels, PLATFORM_LABELS_VERSION } from './platform-labels.js';
import { analyzeScam, type ScamInput } from './scam/engine.js';
import { detectTextStats } from './text/detector.js';
import { detectTextDeep } from './text/ensemble.js';
import type { LanguageModel } from './text/lm.js';
import type { DetectorResult, PageReport, Verdict } from './types.js';
import { ENGINE_VERSION } from './version.js';
import { detectVideoFrames, type VideoFrameCheck, type VideoSampling } from './video/frames.js';
import { checkVideoProvenance } from './video/provenance.js';

/** Optional host-provided capabilities. Without them the checks that need them are skipped. */
export interface Capabilities {
  /** Local language model for the deep text check (Tier 1). */
  lm?: LanguageModel;
  /** C2PA Content Credentials reader. */
  c2pa?: C2paReader;
}

export interface ImageInput {
  /** The ORIGINAL file bytes, not a screenshot (ADR-0008). */
  bytes: Uint8Array;
  /** Short strings shown next to the image on the page: badges, captions, alt text. */
  nearbyLabels?: string[];
}

export interface PageInput extends ScamInput {
  images?: ImageInput[];
  /** Short strings from anywhere on the page that may be platform AI labels. */
  pageLabels?: string[];
}

const LABEL_DETECTOR = `page.platform-label@${PLATFORM_LABELS_VERSION}`;

function labelResult(
  hostname: string | undefined,
  labels: readonly string[] | undefined,
): DetectorResult | null {
  if (hostname === undefined || labels === undefined || labels.length === 0) return null;
  const hits = matchPlatformLabels(hostname, labels);
  if (hits.length === 0) return null;
  return {
    status: 'assessed',
    signal: {
      detector: LABEL_DETECTOR,
      modality: 'page',
      kind: 'platform_label',
      score: 1,
      reasons: ['platform_label_ai'],
      details: { platform: hits[0]!.platform, label: hits[0]!.text },
    },
  };
}

/**
 * Checks a block of text (a message, an email, a page's main text): scam risk first (ADR-0007),
 * then the AI-text verdict. This version needs no model: Tier 0 statistics only.
 */
export function checkText(input: ScamInput): PageReport {
  const scam = analyzeScam(input);
  const verdict = resolveOutcome('text', [detectTextStats(input.text)]);
  return {
    scamRisk: scam.risk,
    scamReasons: scam.reasons,
    items: [verdict],
    engine: ENGINE_VERSION,
  };
}

/**
 * Same as `checkText`, with the Tier 1 detector: needs a local language model (the "deep check").
 * The ensemble already includes the Tier 0 statistics, so it replaces them instead of adding to them.
 */
export async function checkTextDeep(input: ScamInput, lm: LanguageModel): Promise<PageReport> {
  const scam = analyzeScam(input);
  const verdict = resolveOutcome('text', [await detectTextDeep(input.text, lm)]);
  return {
    scamRisk: scam.risk,
    scamReasons: scam.reasons,
    items: [verdict],
    engine: ENGINE_VERSION,
  };
}

/**
 * Checks one image: what the file says about itself (Content Credentials, metadata) and what the
 * site says about it (a platform AI label next to it). Statistical image checks join later in M3.
 */
export async function checkImage(
  image: ImageInput,
  context: { hostname?: string; c2pa?: C2paReader; statistical?: ImageStatisticalCheck } = {},
): Promise<Verdict> {
  const provenance = await checkImageProvenance(image.bytes, context.c2pa);
  const label = labelResult(context.hostname, image.nearbyLabels);
  // The statistical check only adds evidence when the file and the site declare nothing.
  const declared = provenance.outcome === 'verified_ai' || label !== null;
  const statistical =
    context.statistical !== undefined && !declared && image.bytes.length > 0
      ? await runImageStatisticalCheck(image.bytes, context.statistical)
      : null;
  if (label === null && statistical === null) return provenance;
  // Re-resolve with everything. A label counts even when the file itself could not be read.
  const fileResults: DetectorResult[] =
    provenance.outcome === 'not_assessed'
      ? []
      : provenance.signals.map((signal) => ({ status: 'assessed' as const, signal }));
  return resolveOutcome('image', [
    ...fileResults,
    ...(label === null ? [] : [label]),
    ...(statistical === null ? [] : [statistical]),
  ]);
}

export interface VideoInput {
  /** The ORIGINAL video file, when the host could get it (not a screen recording). */
  bytes?: Uint8Array;
  /**
   * Frames for the statistical check, fetched only when needed: the decoder's frames converted by
   * the core's rule (video/yuv.ts), never screenshots. Null when no frames could be read.
   */
  frames?: () => Promise<readonly Pixels[] | null>;
  /** How `frames` were taken: spread over a file (default), or from a video while it played. */
  sampling?: VideoSampling;
  /** Short strings shown next to the video on the page: badges, captions. */
  nearbyLabels?: string[];
}

/**
 * Checks one video: labels and signatures first (file and site), and only when those declare
 * nothing, the experimental frame check.
 */
export async function checkVideo(
  video: VideoInput,
  context: { hostname?: string; c2pa?: C2paReader; frameCheck?: VideoFrameCheck } = {},
): Promise<Verdict> {
  const provenance =
    video.bytes === undefined ? null : await checkVideoProvenance(video.bytes, context.c2pa);
  const label = labelResult(context.hostname, video.nearbyLabels);
  const declared = provenance?.outcome === 'verified_ai' || label !== null;
  let statistical: DetectorResult | null = null;
  if (context.frameCheck !== undefined && video.frames !== undefined && !declared) {
    const frames = await video.frames();
    statistical =
      frames === null
        ? {
            status: 'not_assessed',
            detector: context.frameCheck.model.id,
            reason: 'unreadable_media',
          }
        : await detectVideoFrames(frames, context.frameCheck, video.sampling ?? 'spread');
  }
  const fileResults: DetectorResult[] =
    provenance === null || provenance.outcome === 'not_assessed'
      ? []
      : provenance.signals.map((signal) => ({ status: 'assessed' as const, signal }));
  return resolveOutcome('video', [
    ...fileResults,
    ...(label === null ? [] : [label]),
    ...(statistical === null ? [] : [statistical]),
  ]);
}

/**
 * Checks a whole page: scam risk first, then the main text, each image, and any platform AI
 * label found on the page. Everything runs locally; nothing is fetched here.
 */
export async function checkPage(
  input: PageInput,
  capabilities: Capabilities = {},
): Promise<PageReport> {
  const scam = analyzeScam(input);
  const items: Verdict[] = [];
  if (input.text.trim().length > 0) {
    const text = capabilities.lm
      ? await detectTextDeep(input.text, capabilities.lm)
      : detectTextStats(input.text);
    items.push(resolveOutcome('text', [text]));
  }
  for (const image of input.images ?? []) {
    const context = {
      ...(input.pageHost === undefined ? {} : { hostname: input.pageHost }),
      ...(capabilities.c2pa === undefined ? {} : { c2pa: capabilities.c2pa }),
    };
    items.push(await checkImage(image, context));
  }
  const pageLabel = labelResult(input.pageHost, input.pageLabels);
  if (pageLabel !== null) items.push(resolveOutcome('page', [pageLabel]));
  return { scamRisk: scam.risk, scamReasons: scam.reasons, items, engine: ENGINE_VERSION };
}
