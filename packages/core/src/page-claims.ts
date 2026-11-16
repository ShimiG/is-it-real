/**
 * What a page itself SAYS about a picture or a video: a caption or alt text ("AI-generated image
 * of a harbour"), the uploader's hashtags (#aislop, #veo3), or the file's name
 * (ai-generated-image-1.png).
 *
 * This is the publisher's or uploader's own word. It is not a signed record and not a platform's
 * label, so it never gives "Made with AI"; it gives "Likely made with AI", with the words quoted
 * (ADR-0014). It matters because it is often the only evidence there is: drawn and painted AI
 * pictures cannot be judged by the picture model, and most files carry no label.
 *
 * Patterns are deliberately narrow. They must say that THIS item was made by AI; talking about
 * AI ("AI image generator", "is this AI-generated?", "#ai") is not enough.
 */
export const PAGE_CLAIMS_VERSION = '0.1.0';

export interface PageClaim {
  /** The words that were found, shortened for display. */
  text: string;
  where: 'caption' | 'hashtag' | 'file name';
}

const TOOLS = String.raw`(?:midjourney|dall[\s·.-]?e(?:\s?[23])?|stable diffusion|sdxl|sora(?: ?2)?|veo(?: ?[23](?:\.\d)?)?|firefly|imagen|gemini|chatgpt|gpt-?image|grok|flux|kling|runway|pika|luma|hailuo|seedance|ideogram|leonardo(?: ?ai)?|nano banana)`;
const AI = String.raw`(?:ai|a\.i\.|artificial intelligence)`;

/** Statements that the item was made by AI. Tested on lower-cased text. */
const CLAIMS: RegExp[] = [
  new RegExp(String.raw`\b${AI}[- ]generated\b`),
  new RegExp(
    String.raw`\b(?:generated|made|created|rendered|produced) (?:entirely |fully )?(?:by|with|using|in) (?:an? )?(?:${AI}|${TOOLS})\b`,
  ),
  new RegExp(
    String.raw`\b(?:image|picture|photo|illustration|artwork|art|video|clip)s?:? (?:by|via|from) ${TOOLS}\b`,
  ),
  new RegExp(String.raw`\b${AI}[- ](?:made|created|rendered)\b`),
  // Hebrew: "created with / by AI".
  /נוצר(?:ה|ו)? (?:באמצעות|בעזרת|על ידי|ע"י) (?:ai|בינה מלאכותית)/,
];

/** Words after a claim that turn it into talk ABOUT such content, or a tool for it. */
const NOT_ABOUT_THIS = new RegExp(
  String.raw`^\W{0,3}(?:\w+\W+){0,2}?(?:summar(?:y|ies)|answers?|overviews?|captions?|subtitles?|translations?|descriptions?|replies|responses?|labels?|detectors?|detection|checkers?|polic(?:y|ies)|generators?|tools?|models?|content (?:policy|label|warning)|or (?:not|real))\b`,
);
/** A question or a denial just before the claim. */
const DENIED =
  /\b(?:not|never|no|isn'?t|aren'?t|wasn'?t|without|non|is (?:this|it|that)|are these|was (?:this|it))\b[^.!?]{0,24}$/;

/** Hashtags by which uploaders mark their own AI-made posts. A bare #ai is about the topic. */
const HASHTAGS = new RegExp(
  String.raw`#(?:ai[-_]?generated|generated[-_]?by[-_]?ai|made[-_]?with[-_]?ai|ai[-_]?slop|ai[-_]?art(?:work)?|ai[-_]?(?:video|videos|shorts|film|animation|image|images|photo|photos)|sora2|sora[-_]?ai|veo[23]|veo[-_]?ai|midjourney|stable[-_]?diffusion|dall[-_]?e[23]?|kling[-_]?ai|runway[-_]?ml|hailuo[-_]?ai|luma[-_]?ai)(?![\w-])`,
);

const FILE_NAME =
  /(?:^|[-_.])(?:ai[-_]generated|generated[-_]by[-_]ai|made[-_]with[-_]ai)(?=[-_.]|$)/;

const clip = (s: string): string => (s.length > 80 ? `${s.slice(0, 77)}...` : s);

function claimInText(raw: string): PageClaim | null {
  const text = raw.toLowerCase();
  const tag = HASHTAGS.exec(text);
  if (tag !== null) return { text: tag[0], where: 'hashtag' };
  if (text.includes('?')) return null;
  for (const pattern of CLAIMS) {
    const m = pattern.exec(text);
    if (m === null) continue;
    if (DENIED.test(text.slice(0, m.index))) continue;
    if (NOT_ABOUT_THIS.test(text.slice(m.index + m[0].length))) continue;
    return { text: clip(raw.trim()), where: 'caption' };
  }
  return null;
}

/**
 * @param texts Short texts shown with the item: caption, alt text, title, the uploader's tags.
 * @param address The item's own address; only its file name is looked at.
 */
export function findPageClaim(texts: readonly string[], address?: string): PageClaim | null {
  for (const text of texts) {
    const claim = claimInText(text);
    if (claim !== null) return claim;
  }
  if (address !== undefined && /^https?:/i.test(address)) {
    try {
      const name = decodeURIComponent(
        new URL(address).pathname.split('/').pop() ?? '',
      ).toLowerCase();
      const m = FILE_NAME.exec(name);
      // "ai-generated-image-1.png" says so; "ai-generated-content-policy.png" is about something else.
      if (
        m !== null &&
        !NOT_ABOUT_THIS.test(name.slice(m.index + m[0].length).replace(/[-_.]+/g, ' '))
      )
        return { text: clip(name), where: 'file name' };
    } catch {
      // Not a usable address.
    }
  }
  return null;
}
