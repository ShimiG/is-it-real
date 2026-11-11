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
  movedOn: 'You are on a different page now. Press the button to check this one.',
  itemText: 'The text on this page',
  itemImage: (n: number) => `Picture ${n}`,
  itemVideo: (n: number) => `Video ${n}`,
  itemPageLabel: 'Label shown by this site',
  sameResult: (n: number, title: string) => `${n} pictures: ${title}`,
  showPictures: 'Show these pictures',
  notChecked: (n: number) =>
    n === 1 ? '1 more picture was not checked.' : `${n} more pictures were not checked.`,
  noteImageUnreadable: 'We could not load this picture, so only labels next to it were checked.',
  noteVideoStreamed:
    'This video is sent in small pieces, so there is no file to check. Only labels shown next to it were checked.',
  noteVideoUnreadable:
    'We could not load this video file, so only labels shown next to it were checked.',
  noteVideoWatched:
    'We looked at a few frames while the video played. A copy on a video site has lost any label the original file carried.',
  watchButton: 'Check this video while it plays',
  watchStarting: 'Looking at the video. Keep it playing.',
  watchProgress: (done: number, total: number) =>
    `Looking at the video: ${done} of ${total} frames. Keep it playing.`,
  watchPaused: 'The video is not playing. Press play on the video, then press this button again.',
  watchProtected:
    'This video is protected or comes from another site in a way that does not let us read its picture.',
  watchUnsupported: 'This video is in a format we cannot read.',
  watchGone: 'The video is no longer on the page. Check the page again.',
  noteVideoNoFrames:
    'The picture check is not set up, so only the labels and the signature of this video were checked.',
  noteVideoExperimental:
    'The frame check for video is experimental: it looks at a few still frames, catches only some AI video, and cannot detect a face swap (a real face put on another video, a "deepfake").',
  noCredentialsCheck:
    'Digital signatures (Content Credentials) could not be checked in this browser. File labels were checked.',
  noPictureModel:
    'The picture check is not set up yet, so pictures were only checked for labels and signatures.',
  reminder:
    '"No clear signs" only means we found nothing. It does not prove that something is real or safe.',
  setupHeading: 'Picture check',
  setupAbsent:
    'Not set up yet. The picture check can spot some AI-made photos that carry no label. It needs one download of about 220 MB. After that it works without the internet, and your pictures still never leave this computer.',
  setupButton: 'Set up the picture check',
  setupDownloading: (doneMb: number, totalMb: number) =>
    `Downloading: ${doneMb} of ${totalMb} MB. You can keep using the browser.`,
  setupReady: 'Ready. Pictures without a label are checked on this computer.',
  setupFailed: 'The download did not finish. Check your internet connection and try again.',
  setupRetry: 'Try again',
  menuCheckPicture: 'Is It Real? Check this picture',
  pictureHeading: 'The picture you chose',
  checkingPicture: 'Checking the picture…',
  itemPicture: 'This picture',
  actionTitle: 'Is It Real? Check this page',
  badgeScamHigh: 'Is It Real? Warning: this page looks like a scam. Click to see why.',
  badgeScamMedium: 'Is It Real? Be careful: this page has some warning signs. Click to see why.',
  badgeAiLabel: 'Is It Real? This site says something on this page was made with AI. Click to see.',
  quietChecks: 'Quiet checks while I browse',
  quietChecksAbout:
    'When this is on, each page is checked for scam warning signs and for the site\'s own "AI" labels as it opens. A mark appears on the Is It Real? button if something is found. Nothing is sent anywhere, and no pictures are fetched.',
  largeText: 'Larger text',
  readAloud: 'Read the result aloud',
  stopReading: 'Stop reading',
  sourceText: 'page text',
  sourcePageLabel: 'label shown on the page',
  sourceStream: 'streamed video',
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
