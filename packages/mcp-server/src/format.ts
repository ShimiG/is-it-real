import type { ItemResult, ScamSummary } from '@isitreal/core';

export { itemFromVerdict, scamFromReport, type ItemResult } from '@isitreal/core';

export interface ToolResult {
  /** Ready-to-read lines, scam risk first. */
  summary: string[];
  scam: ScamSummary | null;
  items: ItemResult[];
  checks_available: {
    content_credentials: boolean;
    picture_model: boolean;
    /** Experimental frame check for video files (needs the picture model and ffmpeg). */
    video_frames: boolean;
    deep_text_check: boolean;
  };
  how_to_report: string;
  engine: string;
}

export const HOW_TO_REPORT =
  'Report the scam result first, then each item, using the titles and reason texts given here. ' +
  'Do not add your own opinion about whether something is AI-made, and do not change any outcome. ' +
  'Never say content is "real", "human", "genuine" or "safe": "No clear signs" only means nothing was found. ' +
  'Use plain, calm language. If there is a scam warning, repeat the advice.';

export function summaryLines(scam: ToolResult['scam'], items: readonly ItemResult[]): string[] {
  const lines: string[] = [];
  if (scam !== null) {
    lines.push(`Scam check: ${scam.headline}`);
    for (const r of scam.reasons) lines.push(`  - ${r.text}`);
    for (const a of scam.advice) lines.push(`  * ${a}`);
  }
  let image = 0;
  let video = 0;
  items.forEach((item) => {
    const label =
      item.kind === 'text'
        ? 'Text'
        : item.kind === 'image'
          ? `Image ${++image}`
          : item.kind === 'video'
            ? `Video ${++video}`
            : 'Page label';
    lines.push(`${label}: ${item.title}. ${item.explanation}`);
    for (const r of item.reasons) lines.push(`  - ${r.text}`);
    if (item.note !== undefined) lines.push(`  (${item.note})`);
  });
  return lines;
}
