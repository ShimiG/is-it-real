# 0008: Read the DOM first; video capture strategy per host

**Status:** accepted (2026-11-09)

## Context

Screenshots destroy file metadata, C2PA manifests and frequency signals, and OCR corrupts the token statistics text detectors rely on. Spike (a) compared ways to get video frames into the local MCP server.

## Decision

- Text and media are read from the DOM and the original files. Screenshot input is a fallback, labelled lower confidence.
- Video in the plugin: download direct `.mp4`/`.webm` files and extract frames with ffmpeg; for streamed video, use screenshots saved to disk and passed by path. No page-to-localhost bridge (Chrome's Local Network Access prompt).
- Video in the extension: frames from the `<video>` element when readable, else `chrome.tabCapture` in an offscreen document.
- When nothing works (DRM, blocked media), the answer is "Not assessed: couldn't check this video".

## Consequences

- Logged-in or streamed video gets weaker checks in the plugin phase than in the extension.
- The eval compares the same clips as files vs. screenshots to measure the penalty (M5).
