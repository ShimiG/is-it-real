import type { C2paReader } from '@isitreal/core';
import { createWasmC2paReader } from '../engine/c2pa.js';
import { checkPageData, type EngineCapabilities } from '../engine/check.js';
import { fetchImageBytes } from '../engine/media.js';
import { ENGINE_PORT, type EngineEvent, type EngineRequest } from '../messages.js';

/**
 * The engine page: a hidden extension page that runs the checks. The side panel connects with a
 * port, sends a page, and gets progress and the result back. Everything runs here, on this
 * computer.
 */
/** Loaded on first use and kept. Null when it cannot be loaded; the panel then says so. */
let c2pa: Promise<C2paReader | null> | null = null;
const loadC2pa = () =>
  (c2pa ??= (async () => {
    try {
      const trust = await fetch(chrome.runtime.getURL('trust/C2PA-TRUST-LIST.pem'));
      return await createWasmC2paReader(chrome.runtime.getURL('c2pa.wasm'), {
        trustAnchorsPem: await trust.text(),
      });
    } catch (err) {
      console.error('Content Credentials reader could not be loaded', err);
      return null;
    }
  })());

const capabilities: Omit<EngineCapabilities, 'onProgress'> = {
  fetchBytes: fetchImageBytes,
  c2pa: loadC2pa,
  imageCheck: async () => null,
};

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== ENGINE_PORT) return;
  let open = true;
  port.onDisconnect.addListener(() => {
    open = false;
  });
  const send = (event: EngineEvent) => {
    if (open) port.postMessage(event);
  };
  port.onMessage.addListener((request: EngineRequest) => {
    if (request?.type !== 'check-page') return;
    checkPageData(request.page, {
      ...capabilities,
      onProgress: (done, total) => send({ type: 'progress', done, total }),
    }).then(
      (result) => send({ type: 'result', result }),
      (err: unknown) => send({ type: 'error', message: String(err) }),
    );
  });
});
