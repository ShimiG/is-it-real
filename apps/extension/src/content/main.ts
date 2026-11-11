import type { ContentRequest } from '../messages.js';
import { extractPage } from './extract.js';

/**
 * Content script: answers "what is on this page?" when the side panel asks. It does nothing on
 * its own and never changes the page.
 */
declare global {
  interface Window {
    __isItRealContent?: boolean;
  }
}

// The script can be injected a second time into a tab that was open before the extension was
// installed; answer only once.
if (window.__isItRealContent !== true) {
  window.__isItRealContent = true;
  chrome.runtime.onMessage.addListener((message: ContentRequest, _sender, respond) => {
    if (message?.type !== 'extract-page') return false;
    try {
      respond({ ok: true, page: extractPage() });
    } catch (err) {
      respond({ ok: false, error: String(err) });
    }
    return false;
  });
}
