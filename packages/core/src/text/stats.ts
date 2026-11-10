import { normalizeText, splitSentences, words } from './normalize.js';

/**
 * Tier 0 text features: pure statistics, no model (PLAN section 5.1). Each is weak alone; a small
 * logistic model trained in `eval/` combines them (`text-stats.model.json`).
 *
 * Every feature is a rate or ratio, so text length matters less.
 */
export const TEXT_FEATURES = [
  'sentLenMean',
  'sentLenCV',
  'mattr',
  'wordLenMean',
  'functionWordRate',
  'commaPerSentence',
  'semicolonColonRate',
  'dashRate',
  'parenRate',
  'quoteRate',
  'exclaimQuestionRate',
  'contractionRate',
  'firstPersonRate',
  'secondPersonRate',
  'aiPhraseRate',
  'repeatedTrigramRate',
  'digitRate',
  'capitalizedRate',
] as const;
export type TextFeature = (typeof TEXT_FEATURES)[number];
export type TextFeatures = Record<TextFeature, number>;

const FUNCTION_WORDS = new Set(
  'the a an and or but if of to in on at by for with from as is are was were be been being it its this that these those there here which who whom whose what when where why how not no so than then too very can could will would shall should may might must do does did have has had i you he she we they me him her us them my your his our their'.split(
    ' ',
  ),
);
const FIRST_PERSON = new Set(['i', 'me', 'my', 'mine', 'we', 'us', 'our', 'ours']);
const SECOND_PERSON = new Set(['you', 'your', 'yours']);

/**
 * Words and phrases that chat models over-use (per 100 words). Easy to game and also used by
 * people, so it gets a learned, usually small, weight.
 */
export const AI_PHRASES: readonly RegExp[] = [
  /\bdelve\w*/g,
  /\btapestry\b/g,
  /\btestament to\b/g,
  /\bit'?s (?:important|worth|crucial) to (?:note|remember|consider)\b/g,
  /\bin conclusion\b/g,
  /\b(?:furthermore|moreover|additionally|ultimately|notably)\b/g,
  /\b(?:crucial|pivotal|vibrant|seamless(?:ly)?|intricate|meticulous(?:ly)?|multifaceted|nuanced|comprehensive)\b/g,
  /\b(?:embark|navigate|navigating|foster(?:ing)?|leverag(?:e|ing)|underscore[sd]?|showcas(?:e|ing)|elevate|enhance[sd]?|streamline)\b/g,
  /\b(?:realm|landscape|journey|insights?)\b/g,
  /\b(?:a (?:wide|diverse) (?:range|array|variety) of|plays? a (?:key|vital|crucial|significant) role)\b/g,
];

/** Moving-average type-token ratio (lexical diversity that doesn't fall with length). */
export function mattr(tokens: readonly string[], window = 50): number {
  if (tokens.length === 0) return 0;
  if (tokens.length <= window) return new Set(tokens).size / tokens.length;
  const counts = new Map<string, number>();
  let distinct = 0;
  let total = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const c = counts.get(t) ?? 0;
    if (c === 0) distinct++;
    counts.set(t, c + 1);
    if (i >= window) {
      const old = tokens[i - window]!;
      const oc = counts.get(old)!;
      if (oc === 1) distinct--;
      counts.set(old, oc - 1);
    }
    if (i >= window - 1) total += distinct / window;
  }
  return total / (tokens.length - window + 1);
}

const mean = (xs: readonly number[]) =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
const cv = (xs: readonly number[]) => {
  const m = mean(xs);
  if (xs.length < 2 || m === 0) return 0;
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))) / m;
};
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

export function textFeatures(raw: string): TextFeatures {
  const text = normalizeText(raw);
  const sentences = splitSentences(text);
  const toks = words(text);
  const lower = toks.map((w) => w.toLowerCase());
  const n = Math.max(1, toks.length);
  const per100 = (k: number) => (100 * k) / n;
  const sentLens = sentences.map((s) => words(s).length).filter((l) => l > 0);
  const lowerText = text.toLowerCase();

  const trigrams = new Map<string, number>();
  for (let i = 0; i + 2 < lower.length; i++) {
    const k = `${lower[i]} ${lower[i + 1]} ${lower[i + 2]}`;
    trigrams.set(k, (trigrams.get(k) ?? 0) + 1);
  }
  const repeated = [...trigrams.values()].filter((c) => c > 1).reduce((a, c) => a + c, 0);

  // Capitalised words that don't start a sentence (proper nouns, acronyms): specificity.
  let capitalized = 0;
  for (const s of sentences) {
    const ws = words(s);
    for (let i = 1; i < ws.length; i++) if (/^\p{Lu}/u.test(ws[i]!)) capitalized++;
  }

  return {
    sentLenMean: mean(sentLens),
    sentLenCV: cv(sentLens),
    mattr: mattr(lower),
    wordLenMean: mean(toks.map((w) => w.length)),
    functionWordRate: lower.filter((w) => FUNCTION_WORDS.has(w)).length / n,
    commaPerSentence: count(text, /,/g) / Math.max(1, sentences.length),
    semicolonColonRate: per100(count(text, /[;:]/g)),
    dashRate: per100(count(text, /\s-\s|--/g)),
    parenRate: per100(count(text, /\(/g)),
    quoteRate: per100(count(text, /"/g)),
    exclaimQuestionRate: per100(count(text, /[!?]/g)),
    contractionRate: per100(lower.filter((w) => /'(?:s|t|re|ve|ll|d|m)$/.test(w)).length),
    firstPersonRate: per100(lower.filter((w) => FIRST_PERSON.has(w)).length),
    secondPersonRate: per100(lower.filter((w) => SECOND_PERSON.has(w)).length),
    aiPhraseRate: per100(AI_PHRASES.reduce((a, re) => a + count(lowerText, re), 0)),
    repeatedTrigramRate: repeated / Math.max(1, lower.length - 2),
    digitRate: per100(toks.filter((w) => /^\p{N}/u.test(w)).length),
    capitalizedRate: per100(capitalized),
  };
}

const EN_STOPWORDS = new Set(
  'the of and to a in is it that for was on are as with be at by this have from or not but what all were we when your can said there an which they you he she his her i'.split(
    ' ',
  ),
);

/**
 * Cheap English check for the "Not assessed: unsupported language" gate. Statistical text
 * detectors are only calibrated on English; other languages must not get a verdict.
 */
export function isLikelyEnglish(raw: string): boolean {
  const toks = words(raw).map((w) => w.toLowerCase());
  if (toks.length < 5) return false;
  const letters = raw.match(/\p{L}/gu) ?? [];
  const latin = letters.filter((c) => /[A-Za-z]/.test(c)).length;
  if (latin / Math.max(1, letters.length) < 0.85) return false;
  const stop = toks.filter((w) => EN_STOPWORDS.has(w)).length / toks.length;
  return stop >= 0.18;
}
