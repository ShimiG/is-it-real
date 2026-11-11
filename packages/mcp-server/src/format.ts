import {
  OUTCOME_TEXT,
  REASON_TEXT,
  SCAM_ADVICE,
  SCAM_TEXT,
  type PageReport,
  type ReasonCode,
  type ScamRisk,
  type Verdict,
} from '@isitreal/core';

/** One checked item, as shown to Claude. Plain words first; codes for anyone who needs them. */
export interface ItemResult {
  kind: 'text' | 'image' | 'page';
  source: string;
  outcome: Verdict['outcome'];
  title: string;
  explanation: string;
  reasons: { code: ReasonCode; text: string }[];
  /** Facts from the checks (signer, generator, platform label...). No page content beyond short labels. */
  evidence?: Record<string, string | number | boolean>;
  note?: string;
}

export interface ToolResult {
  /** Ready-to-read lines, scam risk first. */
  summary: string[];
  scam: {
    risk: ScamRisk;
    headline: string;
    reasons: { code: ReasonCode; text: string; evidence?: string }[];
    advice: readonly string[];
  } | null;
  items: ItemResult[];
  checks_available: { content_credentials: boolean; deep_text_check: boolean };
  how_to_report: string;
  engine: string;
}

export const HOW_TO_REPORT =
  'Report the scam result first, then each item, using the titles and reason texts given here. ' +
  'Do not add your own opinion about whether something is AI-made, and do not change any outcome. ' +
  'Never say content is "real", "human", "genuine" or "safe": "No clear signs" only means nothing was found. ' +
  'Use plain, calm language. If there is a scam warning, repeat the advice.';

const reasonList = (codes: readonly ReasonCode[]) =>
  codes.map((code) => ({ code, text: REASON_TEXT[code] }));

export function itemFromVerdict(v: Verdict, source: string, note?: string): ItemResult {
  const evidence: Record<string, string | number | boolean> = {};
  for (const s of v.signals) {
    if (s.kind === 'scam_rule' || s.details === undefined) continue;
    for (const [k, val] of Object.entries(s.details)) {
      if (['raw', 'calibrationSize', 'format', 'fdCriterion'].includes(k)) continue;
      evidence[k] = val;
    }
  }
  const text = OUTCOME_TEXT[v.outcome];
  return {
    kind: v.modality === 'video' ? 'image' : v.modality,
    source,
    outcome: v.outcome,
    title: text.title,
    explanation: text.body,
    reasons: reasonList(v.reasons),
    ...(Object.keys(evidence).length > 0 ? { evidence } : {}),
    ...(note === undefined ? {} : { note }),
  };
}

export function scamFromReport(
  report: PageReport,
  evidence: Map<ReasonCode, string>,
): ToolResult['scam'] {
  return {
    risk: report.scamRisk,
    headline: SCAM_TEXT[report.scamRisk],
    reasons: report.scamReasons.map((code) => ({
      code,
      text: REASON_TEXT[code],
      ...(evidence.has(code) ? { evidence: evidence.get(code)! } : {}),
    })),
    advice: report.scamRisk === 'high' || report.scamRisk === 'medium' ? SCAM_ADVICE : [],
  };
}

export function summaryLines(scam: ToolResult['scam'], items: readonly ItemResult[]): string[] {
  const lines: string[] = [];
  if (scam !== null) {
    lines.push(`Scam check: ${scam.headline}`);
    for (const r of scam.reasons) lines.push(`  - ${r.text}`);
    for (const a of scam.advice) lines.push(`  * ${a}`);
  }
  let image = 0;
  items.forEach((item) => {
    const label =
      item.kind === 'text' ? 'Text' : item.kind === 'image' ? `Image ${++image}` : 'Page label';
    lines.push(`${label}: ${item.title}. ${item.explanation}`);
    for (const r of item.reasons) lines.push(`  - ${r.text}`);
    if (item.note !== undefined) lines.push(`  (${item.note})`);
  });
  return lines;
}
