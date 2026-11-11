import { checkPageData, type EngineCapabilities } from '../engine/check.js';
import { fetchImageBytes } from '../engine/media.js';
import { ENGINE_PORT, type EngineEvent, type EngineRequest } from '../messages.js';

/**
 * The engine page: a hidden extension page that runs the checks. The side panel connects with a
 * port, sends a page, and gets progress and the result back. Everything runs here, on this
 * computer.
 */
const capabilities: Omit<EngineCapabilities, 'onProgress'> = {
  fetchBytes: fetchImageBytes,
  c2pa: async () => null,
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
