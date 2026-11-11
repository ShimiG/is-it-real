import { analyzeScam, matchPlatformLabels } from '@isitreal/core';
import {
  PENDING_PICTURE,
  SETTING_BACKGROUND,
  type BackgroundRequest,
  type PendingPicture,
  type QuickPage,
} from './messages.js';
import { STRINGS } from './strings.js';

/**
 * Background service worker. It wires things together: opens the side panel when the toolbar
 * button is pressed, starts the hidden engine page when a check is asked for, and sets a quiet
 * badge on the toolbar button from the cheap checks (scam rules and the site's own AI labels).
 * The model checks do not run here (a service worker can be stopped at any time and cannot run
 * the models).
 */
const ENGINE_PAGE = 'offscreen.html';

const MENU_CHECK_PICTURE = 'check-picture';

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  chrome.contextMenus.create({
    id: MENU_CHECK_PICTURE,
    title: STRINGS.menuCheckPicture,
    contexts: ['image'],
  });
});

// Right-click on a picture: open the side panel and leave the request where the panel finds it.
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_CHECK_PICTURE || tab?.id === undefined || !info.srcUrl) return;
  // Opening the panel is only allowed directly in answer to the click, so it comes first.
  void chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
  void chrome.storage.session.set({
    [PENDING_PICTURE]: {
      url: info.srcUrl,
      pageUrl: info.pageUrl ?? tab.url ?? '',
      at: Date.now(),
    } satisfies PendingPicture,
  });
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

/** What the badge says. Words are in the tooltip; the badge itself is a mark, never a verdict. */
export interface Badge {
  text: string;
  color: string;
  title: string;
}

/**
 * The quiet check: scam rules on the page text and links, and the site's own AI labels. No
 * picture is fetched and no model runs. It never interrupts: it only marks the toolbar button
 * (ADR-0013: alerts wait until false alarms on ordinary web pages have been measured).
 */
export function quickBadge(page: QuickPage): Badge | null {
  let hostname: string | undefined;
  try {
    hostname = new URL(page.url).hostname;
  } catch {
    hostname = undefined;
  }
  const scam = analyzeScam({
    text: page.text,
    links: page.links,
    ...(hostname === undefined ? {} : { pageHost: hostname }),
  });
  if (scam.risk === 'high') return { text: '!', color: '#a30000', title: STRINGS.badgeScamHigh };
  if (scam.risk === 'medium')
    return { text: '!', color: '#7a4100', title: STRINGS.badgeScamMedium };
  if (hostname !== undefined && matchPlatformLabels(hostname, page.pageLabels).length > 0)
    return { text: 'AI', color: '#5b1a8f', title: STRINGS.badgeAiLabel };
  return null;
}

async function showBadge(tabId: number, page: QuickPage): Promise<void> {
  const saved = await chrome.storage.local.get(SETTING_BACKGROUND);
  const badge = saved[SETTING_BACKGROUND] === false ? null : quickBadge(page);
  await chrome.action.setBadgeText({ tabId, text: badge?.text ?? '' });
  await chrome.action.setTitle({ tabId, title: badge?.title ?? STRINGS.actionTitle });
  if (badge !== null) {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: badge.color });
    await chrome.action.setBadgeTextColor({ tabId, color: '#ffffff' });
  }
}

chrome.runtime.onMessage.addListener((message: BackgroundRequest, sender, respond) => {
  if (message?.type === 'ensure-engine') {
    ensureEngine().then(
      () => respond({ ok: true }),
      (err: unknown) => respond({ ok: false, error: String(err) }),
    );
    return true;
  }
  if (message?.type === 'quick-scan' && sender.tab?.id !== undefined && sender.frameId === 0) {
    void showBadge(sender.tab.id, message.page).catch(() => {
      // The tab was closed in the meantime.
    });
  }
  return false;
});
