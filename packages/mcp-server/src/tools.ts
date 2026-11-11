import {
  ENGINE_VERSION,
  analyzeScam,
  checkImage,
  detectTextDeep,
  detectTextStats,
  matchPlatformLabels,
  resolveOutcome,
  type C2paReader,
  type LanguageModel,
  type PageReport,
  type ReasonCode,
  type Verdict,
} from '@isitreal/core';
import {
  HOW_TO_REPORT,
  itemFromVerdict,
  scamFromReport,
  summaryLines,
  type ItemResult,
  type ToolResult,
} from './format.js';
import { MediaError, loadFromPath, loadFromUrl, type MediaOptions } from './media.js';

/** What the server could load. Each check degrades gracefully when its part is missing. */
export interface Capabilities {
  /** Content Credentials reader; loaded lazily because it may still be installing. */
  c2pa: () => Promise<C2paReader | null>;
  lm: LanguageModel | null;
  media?: MediaOptions;
}

export interface ImageRef {
  url?: string | undefined;
  path?: string | undefined;
  nearby_labels?: string[] | undefined;
}

export interface PageArgs {
  page_url?: string | undefined;
  text?: string | undefined;
  links?: { text: string; href: string }[] | undefined;
  images?: ImageRef[] | undefined;
  page_labels?: string[] | undefined;
}

export const MAX_IMAGES = 12;

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
  const verdict = await checkImage(
    { bytes, nearbyLabels: labels },
    { ...(hostname === undefined ? {} : { hostname }), ...(c2pa === null ? {} : { c2pa }) },
  );
  const note =
    c2pa === null
      ? 'Content Credentials could not be checked on this computer; file metadata was checked.'
      : undefined;
  return itemFromVerdict(verdict, source, note);
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
  return {
    summary,
    scam,
    items,
    checks_available: {
      content_credentials: (await caps.c2pa()) !== null,
      deep_text_check: caps.lm !== null,
    },
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
    checks_available: {
      content_credentials: (await caps.c2pa()) !== null,
      deep_text_check: caps.lm !== null,
    },
    how_to_report: HOW_TO_REPORT,
    engine: ENGINE_VERSION,
  };
}
