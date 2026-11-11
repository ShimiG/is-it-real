import {
  ENGINE_VERSION,
  analyzeScam,
  checkImage,
  detectTextStats,
  itemFromVerdict,
  matchPlatformLabels,
  resolveOutcome,
  scamFromReport,
  type C2paReader,
  type ImageStatisticalCheck,
  type PageReport,
  type ReasonCode,
} from '@isitreal/core';
import type { PageData, PanelItem, PanelResult } from '../messages.js';
import { STRINGS } from '../strings.js';

/** Images checked per page, largest first. */
export const MAX_IMAGES = 12;

/** What the host (the hidden extension page) provides. Each check is skipped when its part is missing. */
export interface EngineCapabilities {
  /** The image file as the site serves it. Throws when it cannot be loaded. */
  fetchBytes(url: string): Promise<Uint8Array>;
  /** Content Credentials reader, or null when it could not be loaded. */
  c2pa: () => Promise<C2paReader | null>;
  /** Picture model and photo gate, or null when not downloaded yet. */
  imageCheck: () => Promise<ImageStatisticalCheck | null>;
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
    return {
      ...itemFromVerdict(fromLabels, ref.url, STRINGS.noteImageUnreadable),
      preview: ref.url,
    };
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
  return { ...itemFromVerdict(verdict, ref.url), preview: ref.url };
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
  const total = images.length + 1;
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
