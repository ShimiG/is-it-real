/**
 * Every sentence the extension itself shows, in one place, so other languages can be added
 * without touching code. The wording of results (titles, reasons, advice) comes from the shared
 * core (packages/core/src/reasons/en.ts), so the plugin and the extension say the same thing.
 */
export const STRINGS = {
  appName: 'Is It Real?',
  tagline:
    'Checks this page for scam warning signs and AI-made content. Everything stays on your computer.',
  checkButton: 'Check this page',
  checkAgain: 'Check again',
  checking: 'Checking the page…',
  progress: (done: number, total: number) => `Checked ${done} of ${total}`,
  scamHeading: 'Scam check',
  aiHeading: 'Made with AI?',
  adviceHeading: 'What should I do?',
  whyHeading: 'Why',
  nothingToCheck: 'There was nothing on this page we could check.',
  cannotCheckPage:
    'This page cannot be checked. Browser pages, the Web Store and some protected pages do not allow it.',
  pageNotReady: 'The page is still loading. Wait a moment and press the button again.',
  failed: 'Something went wrong while checking. Please try again.',
  itemText: 'The text on this page',
  itemImage: (n: number) => `Picture ${n}`,
  itemVideo: (n: number) => `Video ${n}`,
  itemPageLabel: 'Label shown by this site',
  sameResult: (n: number, title: string) => `${n} pictures: ${title}`,
  showPictures: 'Show these pictures',
  notChecked: (n: number) =>
    n === 1 ? '1 more picture was not checked.' : `${n} more pictures were not checked.`,
  noteImageUnreadable: 'We could not load this picture, so only labels next to it were checked.',
  noCredentialsCheck:
    'Digital signatures (Content Credentials) could not be checked in this browser. File labels were checked.',
  noPictureModel:
    'The picture check is not set up yet, so pictures were only checked for labels and signatures.',
  reminder:
    '"No clear signs" only means we found nothing. It does not prove that something is real or safe.',
  largeText: 'Larger text',
  readAloud: 'Read the result aloud',
  stopReading: 'Stop reading',
  sourceText: 'page text',
  sourcePageLabel: 'label shown on the page',
  signedBy: (who: string) => `Signed by: ${who}`,
  madeWith: (tool: string) => `Tool named in the signature: ${tool}`,
  siteLabel: (label: string) => `Label on the page: “${label}”`,
  found: (text: string) => `Found on the page: “${text}”`,
  speechScam: 'Scam check.',
  speechAi: 'Made with AI?',
  speechOthers: (n: number) =>
    n === 1 ? 'Nothing was found in the other item.' : `Nothing was found in the other ${n} items.`,
  version: (extension: string, engine: string) => `Version ${extension} (engine ${engine})`,
} as const;
