# Spike (a): getting video frames in the Claude plugin phase

**Date:** 2026-11-09 · **Status:** done · **Feeds:** ADR-0008, M5

## Question

In Phase 1 the detection runs in a local MCP server, while the page lives in the user's Chrome
(driven by Claude in Chrome). How do frames of a video on the page reach our detectors?

## Options tested on paper

| Option                             | How                                                                                                                                                                    | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Direct file**                 | Claude reads the `<video>` `src`; if it's a plain `.mp4`/`.webm` URL, the MCP server downloads it and extracts frames with ffmpeg                                      | **Keep.** Full quality, metadata and C2PA available. Fails for logged-in content (the server doesn't have the browser's cookies) and for streamed video                                                                                                                                                                                                                                                                                                                                                              |
| **B. Page-to-localhost bridge**    | A page script draws the video into a canvas and POSTs frames to the MCP server on `127.0.0.1`                                                                          | **Drop.** Since Chrome 142, a public site calling `localhost` triggers a _Local Network Access_ permission prompt per site ([Chromium intent to ship](https://groups.google.com/a/chromium.org/g/blink-dev/c/cwu_RUmBpzY), [explainer](https://blog.openreplay.com/chrome-local-network-access-lna-permission/)). That's a confusing security prompt for exactly the users we protect. It also needs a page-JavaScript tool that the Claude in Chrome docs don't confirm, and cross-origin video "taints" the canvas |
| **C. Screenshots saved to disk**   | Claude in Chrome saves a few screenshots of the playing video to a folder; Claude passes the **file paths** to our `check_video_frames` tool, which reads them locally | **Keep as fallback.** Works for streamed video (YouTube, Facebook). Screenshots are recompressed and lose metadata (P8), so results are labelled lower confidence                                                                                                                                                                                                                                                                                                                                                    |
| D. Base64 frames as tool arguments | Claude pastes image data into the tool call                                                                                                                            | Drop. Costly model output tokens and error-prone (see spike b)                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

## Decision

- Plugin phase: **A first, C as fallback**, and an honest "couldn't check this video" otherwise
  (DRM video screenshots come out black).
- Extension phase: frames come from the page's `<video>` element when the canvas isn't tainted,
  otherwise from `chrome.tabCapture` in an offscreen document. No localhost traffic.

## Follow-ups

- M4: confirm the exact Claude in Chrome screenshot tool name and where it saves files (run `/mcp` → claude-in-chrome → View tools).
- M5: measure how much screenshot recompression hurts the per-frame image detectors (eval with the same clips as files vs. screenshots).
