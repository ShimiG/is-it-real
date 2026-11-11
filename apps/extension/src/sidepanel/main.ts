import { ENGINE_VERSION } from '@isitreal/core';
import {
  ENGINE_PORT,
  type BackgroundRequest,
  type ContentRequest,
  type EngineEvent,
  type EngineRequest,
  type ModelsState,
  type PageData,
  type PanelResult,
} from '../messages.js';
import { STRINGS } from '../strings.js';
import { renderResult, resultToSpeech } from './render.js';

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const checkButton = byId<HTMLButtonElement>('check');
const status = byId<HTMLParagraphElement>('status');
const progress = byId<HTMLProgressElement>('progress');
const results = byId<HTMLDivElement>('results');
const readAloud = byId<HTMLButtonElement>('read-aloud');
const largeText = byId<HTMLButtonElement>('large-text');
const setupText = byId<HTMLParagraphElement>('setup-text');
const setupProgress = byId<HTMLProgressElement>('setup-progress');
const setupButton = byId<HTMLButtonElement>('setup-button');

let lastResult: PanelResult | null = null;

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
  const ask = () =>
    chrome.tabs.sendMessage(tabId, { type: 'extract-page' } satisfies ContentRequest) as Promise<
      { ok: true; page: PageData } | { ok: false; error: string } | undefined
    >;
  let answer;
  try {
    answer = await ask();
  } catch {
    // The tab was open before the extension was installed: put the page reader in now.
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      answer = await ask();
    } catch {
      throw new UserMessage(STRINGS.cannotCheckPage);
    }
  }
  if (answer === undefined || !answer.ok) throw new UserMessage(STRINGS.pageNotReady);
  return answer.page;
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
    const page = await extract(tab.id!);
    lastResult = await runEngine(page);
    results.replaceChildren(renderResult(lastResult));
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
checkButton.addEventListener('click', () => void check());
readAloud.addEventListener('click', toggleReading);
largeText.addEventListener(
  'click',
  () => void setLargeText(largeText.getAttribute('aria-pressed') !== 'true', true),
);
void chrome.storage.local
  .get('largeText')
  .then((saved) => setLargeText(saved['largeText'] === true, false));
