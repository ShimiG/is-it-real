import { ENGINE_VERSION } from '@isitreal/core';
import {
  ENGINE_PORT,
  type BackgroundRequest,
  type ContentRequest,
  type EngineEvent,
  type EngineRequest,
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

function runEngine(page: PageData): Promise<PanelResult> {
  return new Promise((resolve, reject) => {
    const port = chrome.runtime.connect({ name: ENGINE_PORT });
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
      port.disconnect();
    };
    port.onMessage.addListener((event: EngineEvent) => {
      if (event.type === 'progress') {
        progress.max = event.total;
        progress.value = event.done;
        progress.hidden = false;
        status.textContent = STRINGS.progress(event.done, event.total);
      } else if (event.type === 'result') finish(() => resolve(event.result));
      else finish(() => reject(new Error(event.message)));
    });
    port.onDisconnect.addListener(() => finish(() => reject(new Error('engine closed'))));
    port.postMessage({ type: 'check-page', page } satisfies EngineRequest);
  });
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
    const ready = (await chrome.runtime.sendMessage({
      type: 'ensure-engine',
    } satisfies BackgroundRequest)) as { ok: boolean; error?: string };
    if (!ready.ok) throw new Error(ready.error);
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
checkButton.addEventListener('click', () => void check());
readAloud.addEventListener('click', toggleReading);
largeText.addEventListener(
  'click',
  () => void setLargeText(largeText.getAttribute('aria-pressed') !== 'true', true),
);
void chrome.storage.local
  .get('largeText')
  .then((saved) => setLargeText(saved['largeText'] === true, false));
