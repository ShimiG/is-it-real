import type { BackgroundRequest } from './messages.js';

/**
 * Background service worker. It only wires things together: opens the side panel when the
 * toolbar button is pressed, and starts the hidden engine page when a check is asked for.
 * No checking happens here (a service worker can be stopped at any time and cannot run the
 * models).
 */
const ENGINE_PAGE = 'offscreen.html';

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

let creating: Promise<void> | null = null;

async function ensureEngine(): Promise<void> {
  const existing = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
  if (existing.length > 0) return;
  creating ??= chrome.offscreen
    .createDocument({
      url: ENGINE_PAGE,
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification:
        'Runs the on-device checks (image decoding and the picture model) in a page that can use worker threads.',
    })
    .finally(() => {
      creating = null;
    });
  await creating;
}

chrome.runtime.onMessage.addListener((message: BackgroundRequest, _sender, respond) => {
  if (message?.type !== 'ensure-engine') return false;
  ensureEngine().then(
    () => respond({ ok: true }),
    (err: unknown) => respond({ ok: false, error: String(err) }),
  );
  return true;
});
