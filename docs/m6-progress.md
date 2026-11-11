# M6 progress: standalone browser extension

Working notes for M6 (PLAN.md section 9). Decisions: [ADR-0013](decisions/0013-extension-architecture.md). Code: `apps/extension`.

## Stages

| #   | Stage                                                                                                                                  | Status |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | Extension skeleton: page reader, hidden engine page, side panel, scam rules, text check, site labels, file labels; browser tests       | done   |
| 2   | Content Credentials in the browser (official library, trust list), checked against the plugin                                          | done   |
| 3   | Picture model and photo gate in the browser: one-time download with checksum, same numbers as the plugin (test), progress in the panel | next   |
| 4   | Video: files by link, and frames from the playing video for streamed video                                                             | todo   |
| 5   | Background mode: quiet badges from the cheap checks, alerts only for scams and declared AI; right-click "check this picture"           | todo   |
| 6   | Accessibility check (automated audit, keyboard, screen reader labels, large text), works offline after the download                    | todo   |
| 7   | Packaging, README, results page; try-out with 3 to 5 older users (owner)                                                               | todo   |

## Findings so far

- **Both model files work in the browser on the CPU and give the plugin's numbers** (largest difference 0.005; 16 pictures). About 1.5 s per picture on one thread, 0.6 s on four, plus 0.2 s for the photo gate.
- **WebGPU is not used yet:** on the only GPU available for testing (a software one) it returned wrong numbers.
- **Decoding is identical** to the plugin for 15 of 16 test pictures. The exception is a phone photo with a rotation note in its metadata, which the browser applies and the plugin does not. To handle in stage 3.
- **Content Credentials give the same answer as in the plugin** on every test file: our fixtures, the 26 official C2PA test images, and real ChatGPT, Gemini, Copilot and Sora 2 files (`apps/extension/test/c2pa.test.ts`). The extension uses the WebAssembly build of the official library directly; the library's own browser wrapper starts a worker from generated code, which Chrome does not allow in extensions.
- Chrome gives extension pages a small default text size; the panel sets its own (18 px, 22 px in large-text mode).

## How to try it

```bash
pnpm --filter @isitreal/extension build
```

Then in Chrome: `chrome://extensions`, switch on Developer mode, "Load unpacked", choose `apps/extension/dist`. Open a page, click the extension's button, press "Check this page".
