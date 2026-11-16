import {
  IMAGE_CLASSIFIER_MODEL,
  PHOTO_GATE_MODEL,
  VIDEO_FRAMES_MODEL,
  conformalScore,
} from '@isitreal/core';
import type { ItemDebug, ModelsState, PanelResult, PictureScore } from '../messages.js';

/**
 * A report for the developer: what was checked and the numbers behind each result, so that a
 * surprising answer ("why was this picture not marked?") can be explained. The person saves it
 * as a file and decides whether to pass it on; the extension sends nothing.
 *
 * It holds the page's address, the addresses of its pictures and videos, the results, the short
 * phrases the scam rules matched, and the short texts found on the page that mention AI (the
 * kind sites use for "AI" labels, and captions and tags). It does not hold the rest of the
 * page's text or the pictures.
 *
 * Addresses of pictures and videos are saved without what follows the "?": on many sites that
 * part is a time-limited key to the file, which a report has no need to carry.
 */
export const withoutKey = (address: string): string =>
  /^https?:/i.test(address) ? address.split(/[?#]/)[0]! : address;

export interface DebugReport {
  what: string;
  extension: string;
  engine: string;
  savedAt: string;
  browser: string;
  processorThreads: number;
  page: string;
  pictureCheckFiles: ModelsState['state'] | 'unknown';
  checks: PanelResult['checks'];
  /** A raw number must be above these to give "Likely made with AI". */
  cutOffs: { picture: number; photoGate: number; videoFile: number; videoPlaying: number };
  scam: PanelResult['scam'];
  /** Short texts anywhere on the page that mention AI or similar words: candidates for a site's own label. */
  labelLikeTextsOnPage: string[];
  /** Captions, descriptions and tags on the page that mention AI (shortened), and those shown. */
  wordsAboutAiOnPage: string[];
  shownAsWrittenOnPage: string[];
  items: {
    kind: string;
    source: string;
    outcome: string;
    reasons: string[];
    note?: string;
    evidence?: Record<string, string | number | boolean>;
    /** Short texts next to the item, and the full numbers of each check that ran. */
    textsNextToIt?: string[];
    stillOfVideo?: boolean;
    checks?: ItemDebug['checks'];
    /** For pictures, when the picture check is set up: size and the two raw numbers. */
    numbers?: PictureScore & { photoLike: boolean; scoreAgainstRealPhotos: number };
    numbersProblem?: string;
  }[];
  picturesNotChecked: number;
}

/** The raw number above which a conformal score reaches 0.99, for a sorted calibration list. */
function cutOff(calibration: readonly number[]): number {
  const n = calibration.length;
  // Flagged when at most k calibration values are at or above the number.
  const k = Math.floor(0.01 * (n + 1)) - 1;
  return k < 0 || n === 0 ? Number.POSITIVE_INFINITY : calibration[n - 1 - k]!;
}

export async function buildReport(
  result: PanelResult,
  models: ModelsState | null,
  scorePicture: (url: string) => Promise<PictureScore | null>,
  onProgress: (done: number, total: number) => void = () => {},
): Promise<DebugReport> {
  const pictures = result.items.filter((i) => i.kind === 'image' && /^https?:/.test(i.source));
  let done = 0;
  const items: DebugReport['items'] = [];
  for (const item of result.items) {
    const entry: DebugReport['items'][number] = {
      kind: item.kind,
      source: withoutKey(item.source),
      outcome: item.outcome,
      reasons: item.reasons.map((r) => r.code),
      ...(item.note === undefined ? {} : { note: item.note }),
      ...(item.evidence === undefined ? {} : { evidence: item.evidence }),
      ...(item.debug === undefined
        ? {}
        : {
            textsNextToIt: item.debug.labels,
            ...(item.debug.stillOfVideo === true ? { stillOfVideo: true } : {}),
            checks: item.debug.checks,
          }),
    };
    if (pictures.includes(item) && result.checks.pictureModel) {
      try {
        const score = await scorePicture(item.source);
        if (score === null) entry.numbersProblem = 'the picture could not be decoded';
        else
          entry.numbers = {
            ...score,
            photoLike: score.gate >= PHOTO_GATE_MODEL.threshold,
            scoreAgainstRealPhotos: conformalScore(score.raw, IMAGE_CLASSIFIER_MODEL.calibration),
          };
      } catch (err) {
        entry.numbersProblem = String(err);
      }
      onProgress(++done, pictures.length);
    }
    items.push(entry);
  }
  return {
    what: 'Is It Real? report for the developer. It holds addresses, results and short texts from the page that mention AI, not the rest of the page text or the pictures.',
    extension: chrome.runtime.getManifest().version,
    engine: result.engine,
    savedAt: new Date().toISOString(),
    browser: navigator.userAgent,
    processorThreads: navigator.hardwareConcurrency,
    page: result.url,
    pictureCheckFiles: models?.state ?? 'unknown',
    checks: result.checks,
    cutOffs: {
      picture: cutOff(IMAGE_CLASSIFIER_MODEL.calibration),
      photoGate: PHOTO_GATE_MODEL.threshold,
      videoFile: cutOff(VIDEO_FRAMES_MODEL.calibration),
      videoPlaying: cutOff(VIDEO_FRAMES_MODEL.calibrationWatched),
    },
    scam: result.scam,
    labelLikeTextsOnPage: result.labelsSeen,
    wordsAboutAiOnPage: result.wordsSeen,
    shownAsWrittenOnPage: result.pageSays,
    items,
    picturesNotChecked: result.notChecked,
  };
}

/** Saves the report as a file through the browser's ordinary download. */
export function saveReport(report: DebugReport): void {
  const address = URL.createObjectURL(
    new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = address;
  link.download = `is-it-real-report-${report.savedAt.slice(0, 16).replace(/[:T]/g, '-')}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(address), 10_000);
}
