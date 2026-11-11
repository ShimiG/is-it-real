# Is It Real? (browser extension)

Checks the page you are looking at for **scam warning signs** and for **AI-made text, pictures and video**. It works on its own, without Claude. Version 0.1.0, for Chrome and other Chromium browsers (version 120 or newer).

- Everything runs on your computer. Nothing about the pages you visit is sent anywhere.
- The answers come from fixed rules and measurements, the same ones as in the Claude plugin. What they catch and miss: [EVAL.md](../../EVAL.md).
- It never says something is "real" or "human". When nothing is found, it says _No clear signs_.

## Install (for now: from this repository)

```bash
pnpm install
```

```bash
pnpm --filter @isitreal/extension build
```

In Chrome, open `chrome://extensions`, switch on **Developer mode**, press **Load unpacked** and choose the folder `apps/extension/dist`.

## Use

1. Open a page and press the **Is It Real?** button in the toolbar. A panel opens at the side.
2. Press **Check this page**.
3. Read the result: the scam check first, then what was found about AI. Each finding says why, in plain words.

Other buttons in the panel:

- **Set up the picture check:** a one-time download of about 220 MB (two model files). After that, photos without any label can be checked too, and still nothing leaves your computer.
- **Check this video while it plays:** shown under a video that is streamed (YouTube and similar). Press play on the video, then the button; it looks at a few frames.
- **Read the result aloud**, **Larger text**.
- **Quiet checks while I browse:** as each page opens, it is checked for scam warning signs and for the site's own "AI" labels. If something is found, a mark appears on the toolbar button. It never interrupts.

## What it checks

| Check              | How                                                                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scam warning signs | Rules for pressure, threats, gift-card / crypto / wire payments, secrecy, requests for codes, fake support, look-alike web addresses, links that go somewhere else                          |
| AI pictures        | Content Credentials (signed records from ChatGPT, Gemini, Copilot and others), "made by AI" labels in the file, AI labels the site shows; for plain photos with no label, the picture model |
| AI video           | The same signatures and labels; a few still frames with the picture model (experimental). Face swaps ("deepfakes") are **not** detected                                                     |
| AI text            | Writing statistics (about 110 words or more, English only)                                                                                                                                  |

## Privacy and permissions

| Permission                       | Why                                                                                                            |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Read pages you visit (all sites) | To read the page you ask it to check, and to fetch that page's own pictures from wherever the site keeps them  |
| Side panel                       | To show the result next to the page                                                                            |
| Storage, unlimited storage       | To keep your settings and the two model files                                                                  |
| Offscreen page, scripting        | To run the checks in a hidden page of the extension, and to reach pages that were open before it was installed |

Network use: the pictures and video files of the page being checked (fetched again, without cookies, usually from the browser's cache), and once, if you switch on the picture check, the two model files from their authors' pages (checked against a checksum). Nothing else. No accounts, no statistics, no remote code.

## For developers

| Path                | What                                                                                      |
| ------------------- | ----------------------------------------------------------------------------------------- |
| `src/content/`      | Reads the page (text, links, pictures, videos) and, when asked, frames of a playing video |
| `src/engine/`       | The checks: fetching, decoding, Content Credentials, the model runner, model storage      |
| `src/offscreen/`    | The hidden page that hosts the engine                                                     |
| `src/sidepanel/`    | The panel: one button, the result cards, settings                                         |
| `src/background.ts` | Opens the panel, starts the engine page, sets the quiet badge                             |
| `src/strings.ts`    | Every sentence of the extension's own interface (result wording comes from the core)      |

```bash
pnpm --filter @isitreal/extension run package
```

builds `dist/` and packs it into `is-it-real-<version>.zip`.

Tests (`pnpm test`) run the built extension in a real Chromium with every outside host blocked: the page check, the accessibility audit, the model download with a wrong file, frames from a playing video, the quiet badge. Tests named `*.local.test.ts` need the real model files and evaluation images and are skipped elsewhere; they check that the browser gives the same numbers as the plugin and the evaluation.

Design decisions: [ADR-0013](../../docs/decisions/0013-extension-architecture.md). Progress notes: [docs/m6-progress.md](../../docs/m6-progress.md).

Licence: Apache-2.0. Third-party code: `dist/THIRD_PARTY_NOTICES.md` after a build.
