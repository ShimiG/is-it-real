# Is It Real? (Claude plugin)

Checks the page you are looking at, a message or an image for **scam warning signs** and for **AI-generated text and images**. Version 0.1.0.

- Runs on your computer. Nothing is uploaded; the only network use is downloading the page's own images (and, once, the Content Credentials library, see below).
- The answers come from fixed rules and measurements, not from an AI opinion. Claude collects the page, calls the tools and explains the results.
- It never says something is "real" or "human": when nothing is found, it says _No clear signs_.

## Install

In Claude Code:

```
/plugin marketplace add ShimiG/is-it-real
```

```
/plugin install is-it-real@is-it-real
```

The repository is private for now, so this works for accounts that can read it.

Requirements: Node.js 22 or newer and npm.

## Use

Start Claude Code with Claude in Chrome (`claude --chrome`), open the page in Chrome, and ask: _"Is this page a scam?"_ or _"Was this picture made with AI?"_. You can also paste a message, or give an image link or a file path.

## What it checks

| Check              | How                                                                                                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scam warning signs | Rules for pressure, threats, gift-card / crypto / wire payments, secrecy, requests for codes or personal details, fake support, family emergencies, look-alike web addresses, links that go somewhere else    |
| AI images          | Content Credentials (signed records from ChatGPT, Gemini, Copilot and others), the "made by AI" metadata label, settings left by image generators, AI labels shown by Facebook, Instagram, YouTube and TikTok |
| AI text            | Writing statistics (text of about 110 words or more, English only)                                                                                                                                            |

Limits: images that were re-shared through chat or social apps usually lose their labels; free generators often add none; text written by current AI models is hard to tell apart statistically. Measured results are in [EVAL.md](https://github.com/ShimiG/is-it-real/blob/main/EVAL.md).

## Content Credentials support

The first time an image is checked, the server installs the official C2PA library (`@contentauth/c2pa-node`, about 50 MB) into the plugin's data folder with npm. Until then, or if that is not possible, images get the metadata checks only, and the answer says so.

## For developers

The server is `server/server.mjs`, built from `packages/mcp-server` in the repository (`pnpm --filter @isitreal/mcp-server build`). Environment variables:

| Variable                | Effect                                                                      |
| ----------------------- | --------------------------------------------------------------------------- |
| `ISITREAL_DATA`         | Data folder (set by the plugin to its data folder)                          |
| `ISITREAL_NO_INSTALL=1` | Never run npm; Content Credentials only if already installed                |
| `ISITREAL_GPT2_MODEL`   | Path to `gpt2-lm-head-10.onnx` to enable the deep text check (experimental) |

Licence: Apache-2.0. Bundled third-party code: [server/THIRD_PARTY_NOTICES.md](server/THIRD_PARTY_NOTICES.md).
