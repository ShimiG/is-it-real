import { ENGINE_VERSION, VIDEO_FRAMES_MODEL } from '@isitreal/core';
import type { CaptureProblem } from '../content/videos.js';
import { MAX_VIDEOS } from '../engine/check.js';
import type { PackedFrame } from '../shared/raw-frame.js';
import {
  CAPTURE_PORT,
  ENGINE_PORT,
  PENDING_PICTURE,
  SETTING_BACKGROUND,
  type BackgroundRequest,
  type CaptureEvent,
  type CaptureRequest,
  type ContentAnswer,
  type ContentRequest,
  type EngineEvent,
  type EngineRequest,
  type ModelsState,
  type PageData,
  type PageVideo,
  type PanelItem,
  type PanelResult,
  type PendingPicture,
} from '../messages.js';
import { STRINGS } from '../strings.js';
import {
  renderItem,
  renderPicture,
  renderResult,
  resultToSpeech,
  type WatchTarget,
} from './render.js';

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const checkButton = byId<HTMLButtonElement>('check');
const status = byId<HTMLParagraphElement>('status');
const progress = byId<HTMLProgressElement>('progress');
const results = byId<HTMLDivElement>('results');
const readAloud = byId<HTMLButtonElement>('read-aloud');
const largeText = byId<HTMLButtonElement>('large-text');
const quietChecks = byId<HTMLButtonElement>('quiet-checks');
const setupText = byId<HTMLParagraphElement>('setup-text');
const setupProgress = byId<HTMLProgressElement>('setup-progress');
const setupButton = byId<HTMLButtonElement>('setup-button');

let lastResult: PanelResult | null = null;
let lastTabId: number | null = null;

class UserMessage extends Error {}

/** The tab to check: the one in front, or (for tests and "open in a tab") the one named in the address. */
async function targetTab(): Promise<chrome.tabs.Tab> {
  const wanted = new URLSearchParams(location.search).get('tabId');
  let tab: chrome.tabs.Tab | undefined;
  try {
    tab =
      wanted !== null
        ? await chrome.tabs.get(Number(wanted))
        : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  } catch {
    tab = undefined;
  }
  if (tab?.id === undefined || !/^https?:/.test(tab.url ?? ''))
    throw new UserMessage(STRINGS.cannotCheckPage);
  return tab;
}

async function extract(tabId: number): Promise<PageData> {
  // Frame 0 is the page itself; embedded pages (players, adverts) are asked separately below.
  const ask = () =>
    chrome.tabs.sendMessage(tabId, { type: 'extract-page' } satisfies ContentRequest, {
      frameId: 0,
    }) as Promise<ContentAnswer | undefined>;
  let answer;
  try {
    answer = await ask();
  } catch {
    // The tab was open before the extension was installed: put the page reader in now.
    try {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ['content.js'],
      });
      answer = await ask();
    } catch {
      throw new UserMessage(STRINGS.cannotCheckPage);
    }
  }
  if (answer === undefined || !answer.ok || !('page' in answer))
    throw new UserMessage(STRINGS.pageNotReady);
  const page = answer.page;
  page.videos = [...page.videos, ...(await embeddedVideos(tabId))]
    .sort((a, b) => b.area - a.area)
    .slice(0, MAX_VIDEOS);
  return page;
}

/** Videos inside embedded pages (for example a YouTube player on a news site). */
async function embeddedVideos(tabId: number): Promise<PageVideo[]> {
  try {
    const frames = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => true,
    });
    const found: PageVideo[] = [];
    for (const { frameId } of frames) {
      if (frameId === 0) continue;
      try {
        const answer = (await chrome.tabs.sendMessage(
          tabId,
          { type: 'list-videos' } satisfies ContentRequest,
          { frameId },
        )) as ContentAnswer | undefined;
        if (answer?.ok === true && 'videos' in answer)
          found.push(...answer.videos.map((v) => ({ ...v, frameId })));
      } catch {
        // A frame without the page reader (not a web page) has no videos we can read.
      }
    }
    return found;
  } catch {
    return [];
  }
}

/** Starts the hidden engine page if needed and opens a line to it. */
async function connectEngine(onEvent: (event: EngineEvent, close: () => void) => void): Promise<{
  send: (request: EngineRequest) => void;
  closed: Promise<void>;
}> {
  const ready = (await chrome.runtime.sendMessage({
    type: 'ensure-engine',
  } satisfies BackgroundRequest)) as { ok: boolean; error?: string };
  if (!ready.ok) throw new Error(ready.error);
  const port = chrome.runtime.connect({ name: ENGINE_PORT });
  let finish: () => void = () => {};
  const closed = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const close = () => {
    port.disconnect();
    finish();
  };
  port.onMessage.addListener((event: EngineEvent) => onEvent(event, close));
  port.onDisconnect.addListener(() => finish());
  return { send: (request) => port.postMessage(request), closed };
}

async function runEngine(page: PageData): Promise<PanelResult> {
  let result: PanelResult | null = null;
  let failure: string | null = null;
  const engine = await connectEngine((event, close) => {
    if (event.type === 'progress') {
      progress.max = event.total;
      progress.value = event.done;
      progress.hidden = false;
      status.textContent = STRINGS.progress(event.done, event.total);
    } else if (event.type === 'result') {
      result = event.result;
      close();
    } else if (event.type === 'error') {
      failure = event.message;
      close();
    }
  });
  engine.send({ type: 'check-page', page });
  await engine.closed;
  if (result === null) throw new Error(failure ?? 'engine closed');
  return result;
}

const MB = 1024 * 1024;

function showModels(models: ModelsState): void {
  setupProgress.hidden = models.state !== 'downloading';
  setupButton.hidden = models.state === 'downloading' || models.state === 'ready';
  if (models.state === 'absent') {
    setupText.textContent = STRINGS.setupAbsent;
    setupButton.textContent = STRINGS.setupButton;
  } else if (models.state === 'downloading') {
    setupProgress.max = models.total;
    setupProgress.value = models.done;
    setupText.textContent = STRINGS.setupDownloading(
      Math.round(models.done / MB),
      Math.round(models.total / MB),
    );
  } else if (models.state === 'ready') setupText.textContent = STRINGS.setupReady;
  else {
    setupText.textContent = STRINGS.setupFailed;
    setupButton.textContent = STRINGS.setupRetry;
  }
}

/** Checks one picture the person chose with a right-click, and shows only that. */
async function checkChosenPicture(picture: PendingPicture): Promise<void> {
  checkButton.disabled = true;
  speechSynthesis.cancel();
  readAloud.hidden = true;
  lastResult = null;
  results.replaceChildren();
  status.textContent = STRINGS.checkingPicture;
  try {
    let answer: Extract<EngineEvent, { type: 'picture-result' }> | null = null;
    const engine = await connectEngine((event, close) => {
      if (event.type === 'picture-result') {
        answer = event;
        close();
      } else if (event.type === 'error') close();
    });
    engine.send({ type: 'check-picture', url: picture.url, pageUrl: picture.pageUrl });
    await engine.closed;
    if (answer === null) throw new Error('no answer for the picture');
    const { item, checks } = answer as Extract<EngineEvent, { type: 'picture-result' }>;
    results.replaceChildren(renderPicture(item, checks));
    status.textContent = '';
    results.focus();
  } catch (err) {
    console.error(err);
    status.textContent = STRINGS.failed;
  } finally {
    checkButton.disabled = false;
    checkButton.textContent = STRINGS.checkButton;
  }
}

/** Runs a right-click request left by the background part, once, if it is fresh. */
async function takePendingPicture(): Promise<void> {
  const saved = await chrome.storage.session.get(PENDING_PICTURE);
  const picture = saved[PENDING_PICTURE] as PendingPicture | undefined;
  if (picture === undefined) return;
  await chrome.storage.session.remove(PENDING_PICTURE);
  if (Date.now() - picture.at < 60_000) await checkChosenPicture(picture);
}

const WATCH_PROBLEM: Record<CaptureProblem, string> = {
  paused: STRINGS.watchPaused,
  protected: STRINGS.watchProtected,
  unsupported: STRINGS.watchUnsupported,
  gone: STRINGS.watchGone,
};

/** Watches a video while it plays, has its frames judged, and replaces its card with the answer. */
async function watch(target: WatchTarget): Promise<void> {
  const where = target.item.watch;
  if (where === undefined || lastTabId === null || lastResult === null) return;
  const wanted = VIDEO_FRAMES_MODEL.frames;
  target.button.disabled = true;
  target.status.textContent = STRINGS.watchStarting;
  const frames: PackedFrame[] = [];
  let problem: CaptureProblem | undefined;
  try {
    problem = await new Promise<CaptureProblem | undefined>((resolve) => {
      const port = chrome.tabs.connect(lastTabId!, { name: CAPTURE_PORT, frameId: where.frameId });
      port.onMessage.addListener((event: CaptureEvent) => {
        if (event.type === 'frame') {
          frames.push(event.frame);
          target.status.textContent = STRINGS.watchProgress(frames.length, wanted);
        } else {
          port.disconnect();
          resolve(event.problem);
        }
      });
      port.onDisconnect.addListener(() => resolve('gone'));
      port.postMessage({
        type: 'start',
        index: where.index,
        count: wanted,
      } satisfies CaptureRequest);
    });
    if (frames.length < VIDEO_FRAMES_MODEL.minChecked) {
      target.status.textContent = WATCH_PROBLEM[problem ?? 'paused'];
      return;
    }
    let item: PanelItem | null = null;
    const engine = await connectEngine((event, close) => {
      if (event.type === 'video-result') {
        item = event.item;
        close();
      } else if (event.type === 'error') close();
    });
    for (const frame of frames) engine.send({ type: 'video-frame', frame });
    engine.send({ type: 'check-video-frames', pageUrl: lastResult.url, labels: where.labels });
    await engine.closed;
    if (item === null) throw new Error('no answer for the video');
    const at = lastResult.items.indexOf(target.item);
    if (at >= 0) lastResult.items[at] = item;
    const card = renderItem(target.name, item);
    target.card.replaceWith(card);
    card.tabIndex = -1;
    card.focus();
  } catch (err) {
    console.error(err);
    target.status.textContent = STRINGS.failed;
  } finally {
    target.button.disabled = false;
  }
}

/**
 * A result belongs to one page. When the person goes to another page or another tab, the old
 * result is taken away, so it is never read as a verdict on the new page.
 */
function forgetResult(): void {
  if (lastResult === null && results.childElementCount === 0) return;
  speechSynthesis.cancel();
  lastResult = null;
  lastTabId = null;
  results.replaceChildren();
  readAloud.hidden = true;
  checkButton.textContent = STRINGS.checkButton;
  status.textContent = STRINGS.movedOn;
}

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (tabId !== lastTabId || change.url === undefined || lastResult === null) return;
  // Moving within the same page (a #part) is not a new page.
  if (change.url.split('#')[0] !== lastResult.url.split('#')[0]) forgetResult();
});
// In the real side panel, switching to another tab also changes what "this page" is.
if (!new URLSearchParams(location.search).has('tabId'))
  chrome.tabs.onActivated.addListener(({ tabId }) => {
    if (lastTabId !== null && tabId !== lastTabId) forgetResult();
  });

/** Asks the engine about the picture check's files; with `install`, downloads them first. */
async function models(install: boolean): Promise<void> {
  try {
    const engine = await connectEngine((event, close) => {
      if (event.type === 'error') close();
      if (event.type !== 'models') return;
      showModels(event.models);
      if (event.models.state !== 'downloading') close();
    });
    if (install) {
      // Developers and tests can point the download at their own copy of the files.
      const saved = await chrome.storage.local.get('modelBaseUrl');
      const baseUrl = saved['modelBaseUrl'];
      engine.send({
        type: 'install-models',
        ...(typeof baseUrl === 'string' ? { baseUrl } : {}),
      });
    } else engine.send({ type: 'models-status' });
    await engine.closed;
  } catch (err) {
    console.error(err);
    if (install) showModels({ state: 'failed' });
  }
}

async function check(): Promise<void> {
  checkButton.disabled = true;
  speechSynthesis.cancel();
  readAloud.hidden = true;
  results.replaceChildren();
  status.textContent = STRINGS.checking;
  try {
    const tab = await targetTab();
    lastTabId = tab.id!;
    const page = await extract(lastTabId);
    lastResult = await runEngine(page);
    results.replaceChildren(renderResult(lastResult, { onWatch: (t) => void watch(t) }));
    status.textContent = '';
    readAloud.hidden = false;
    // Move reading position to the result for keyboard and screen-reader users.
    results.focus();
  } catch (err) {
    lastResult = null;
    status.textContent = err instanceof UserMessage ? err.message : STRINGS.failed;
    if (!(err instanceof UserMessage)) console.error(err);
  } finally {
    progress.hidden = true;
    checkButton.disabled = false;
    checkButton.textContent = lastResult === null ? STRINGS.checkButton : STRINGS.checkAgain;
  }
}

function toggleReading(): void {
  if (speechSynthesis.speaking) {
    speechSynthesis.cancel();
    readAloud.textContent = STRINGS.readAloud;
    return;
  }
  if (lastResult === null) return;
  const speech = new SpeechSynthesisUtterance(resultToSpeech(lastResult));
  speech.lang = 'en';
  speech.rate = 0.9;
  speech.onend = () => {
    readAloud.textContent = STRINGS.readAloud;
  };
  readAloud.textContent = STRINGS.stopReading;
  speechSynthesis.speak(speech);
}

async function setLargeText(on: boolean, save: boolean): Promise<void> {
  document.documentElement.classList.toggle('large', on);
  largeText.setAttribute('aria-pressed', String(on));
  if (save) await chrome.storage.local.set({ largeText: on });
}

byId('app-name').textContent = STRINGS.appName;
byId('tagline').textContent = STRINGS.tagline;
byId('version').textContent = STRINGS.version(chrome.runtime.getManifest().version, ENGINE_VERSION);
checkButton.textContent = STRINGS.checkButton;
readAloud.textContent = STRINGS.readAloud;
largeText.textContent = STRINGS.largeText;
byId('setup-title').textContent = STRINGS.setupHeading;
setupButton.addEventListener('click', () => void models(true));
void models(false);
chrome.storage.session.onChanged.addListener((changes) => {
  if (changes[PENDING_PICTURE]?.newValue !== undefined) void takePendingPicture();
});
void takePendingPicture();
checkButton.addEventListener('click', () => void check());
readAloud.addEventListener('click', toggleReading);
largeText.addEventListener(
  'click',
  () => void setLargeText(largeText.getAttribute('aria-pressed') !== 'true', true),
);
quietChecks.textContent = STRINGS.quietChecks;
byId('quiet-about').textContent = STRINGS.quietChecksAbout;
quietChecks.addEventListener('click', () => {
  const on = quietChecks.getAttribute('aria-pressed') !== 'true';
  quietChecks.setAttribute('aria-pressed', String(on));
  void chrome.storage.local.set({ [SETTING_BACKGROUND]: on });
});
void chrome.storage.local.get(['largeText', SETTING_BACKGROUND]).then((saved) => {
  void setLargeText(saved['largeText'] === true, false);
  quietChecks.setAttribute('aria-pressed', String(saved[SETTING_BACKGROUND] !== false));
});
