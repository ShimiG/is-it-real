/** Shared text helpers (pure, no dependencies). */

/** Normalise quotes, dashes and whitespace so patterns can stay simple. */
export function normalizeText(text: string): string {
  return (
    text
      .normalize('NFKC')
      .replace(/[\u2018\u2019\u201B\u2032]/g, "'")
      .replace(/[\u201C\u201D\u201F\u2033]/g, '"')
      .replace(/[\u2010-\u2012]/g, '-')
      // En and em dashes become a spaced dash, so they still count as dashes in the statistics.
      .replace(/\s*[\u2013-\u2015]\s*/g, ' - ')
      .replace(/[\u00A0\u2000-\u200B]/g, ' ')
  );
}

/**
 * Split text into sentences. Deliberately simple: breaks after . ! ? (and line breaks) when
 * followed by whitespace and an uppercase letter, digit or quote. Keeps "Dr. Patel" and "$1.99" intact
 * in most cases; perfect splitting is not needed for the rules or statistics that use it.
 */
export function splitSentences(text: string): string[] {
  return normalizeText(text)
    .split(/(?<=[.!?])\s+(?=["'(]?[A-Z0-9])|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Words: letters (with inner apostrophes/hyphens) or numbers. */
export function words(text: string): string[] {
  return normalizeText(text).match(/\p{L}[\p{L}\p{M}'-]*|\p{N}+(?:[.,]\p{N}+)*/gu) ?? [];
}
