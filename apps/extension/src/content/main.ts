import {
  CAPTURE_PORT,
  type CaptureEvent,
  type CaptureRequest,
  type ContentAnswer,
  type ContentRequest,
} from '../messages.js';
import { SETTING_BACKGROUND, type BackgroundRequest } from '../messages.js';
import { extractPage, extractQuick, listVideos } from './extract.js';
import { captureFrames, visibleVideos } from './videos.js';

/**
 * Content script: answers "what is on this page?" when the side panel asks, and, when asked,
 * watches a playing video to hand over a few of its frames. It does nothing on its own and never
 * changes the page: it does not play, pause or seek anything.
 */
/** Wait for the page to settle before the quiet check. */
const QUIET_CHECK_DELAY_MS = 1200;

declare global {
  interface Window {
    __isItRealContent?: boolean;
  }
}

// The script can be injected a second time into a tab that was open before the extension was
// installed; answer only once.
if (window.__isItRealContent !== true) {
  window.__isItRealContent = true;

  chrome.runtime.onMessage.addListener(
    (message: ContentRequest, _sender, respond: (answer: ContentAnswer) => void) => {
      try {
        if (message?.type === 'extract-page') respond({ ok: true, page: extractPage() });
        else if (message?.type === 'list-videos') respond({ ok: true, videos: listVideos() });
      } catch (err) {
        respond({ ok: false, error: String(err) });
      }
      return false;
    },
  );

  // The quiet check: once per page, in the page itself (not in embedded pages), a moment after
  // it has loaded. Only text, links and short labels are handed to the extension's background
  // part, which stays on this computer.
  if (window === window.top) {
    setTimeout(() => {
      void chrome.storage.local.get(SETTING_BACKGROUND).then((saved) => {
        if (saved[SETTING_BACKGROUND] === false) return;
        void chrome.runtime
          .sendMessage({ type: 'quick-scan', page: extractQuick() } satisfies BackgroundRequest)
          .catch(() => {
            // The extension was reloaded while this page stayed open.
          });
      });
    }, QUIET_CHECK_DELAY_MS);
  }

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== CAPTURE_PORT) return;
    let stop: (() => void) | null = null;
    let open = true;
    const send = (event: CaptureEvent) => {
      if (open) port.postMessage(event);
    };
    port.onDisconnect.addListener(() => {
      open = false;
      stop?.();
    });
    port.onMessage.addListener((request: CaptureRequest) => {
      if (request?.type !== 'start' || stop !== null) return;
      const video = visibleVideos()[request.index];
      if (video === undefined) return send({ type: 'done', problem: 'gone' });
      stop = captureFrames(video, request.count, {
        frame: (frame, count) => send({ type: 'frame', frame, count }),
        done: (problem) => send({ type: 'done', ...(problem === undefined ? {} : { problem }) }),
      });
    });
  });
}
