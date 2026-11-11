# 0013: How the browser extension is built

**Status:** accepted (2026-11-11)

## Context

M6 moves the checks from the Claude plugin into a standalone Chrome extension (PLAN.md sections 7 and 8). The plan named WXT as the build tool and WebGPU for the models. Before building, both models were run in a real Chromium and compared with the plugin's numbers.

## Decision

- **One core, same wording.** The extension uses `@isitreal/core` unchanged. The sentences a person reads (titles, reasons, advice) and the code that turns a verdict into them live in the core (`present.ts`), so the plugin and the extension cannot drift apart.
- **Models run on the CPU (WebAssembly), not on WebGPU, for now.** In Chromium, ONNX Runtime Web's WebAssembly backend gives the same numbers as the plugin for both shipped model files (largest difference 0.005 on a scale where the cut-off is 6.27; 16 pictures), at about 0.8 seconds per picture on four threads. The WebGPU backend could only be tried on a software GPU, where it returned wrong numbers. ADR-0011 says a path is shipped only if a test shows it gives the same numbers, so WebGPU stays off until it can be tested on real hardware.
- **The checks run in a hidden extension page** (an offscreen document), not in the background service worker (which can be stopped at any time and cannot start worker threads) and not in the page being checked. The side panel talks to it over a port; the service worker only opens the panel and starts the hidden page.
- **Original files, not screenshots** (ADR-0008): the hidden page fetches each picture again from the address the page showed, from the browser's cache when possible, without cookies and without a referrer. Only the verdict is kept.
- **The page is only read.** The content script answers "what is on this page" when asked and changes nothing.
- **Permissions:** `sidePanel`, `offscreen`, `scripting`, `storage`, and access to http and https pages (needed to read the page in front of the user and to fetch its pictures from other hosts). No `tabs`, no history, no remote code.
- **Build with esbuild, not WXT.** The repository already bundles the plugin with esbuild; the extension needs four small bundles and a manifest. One build tool less to keep working. If Firefox support needs more, this can be revisited.
- **Tests run the built extension in Chromium** (Playwright): open a page, press the button, read the panel.

## Consequences

- Checking twelve pictures takes about ten seconds on an ordinary laptop instead of two or three with a GPU. The panel shows progress.
- The extension asks for access to all sites, which the Chrome Web Store reviews more closely. The listing must explain why (reading the page being checked, fetching its pictures).
- The picture in the browser must be decoded to the same pixels as in the plugin; phone photos that carry a rotation note are the known difference to handle (the browser applies it, the plugin does not).
