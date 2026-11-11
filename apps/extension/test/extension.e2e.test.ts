import { mkdtempSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IMAGE_CLASSIFIER_MODEL, PHOTO_GATE_MODEL } from '@isitreal/core';
import { browserAvailable, launchWithExtension, startServer, type Loaded } from './browser.js';

/**
 * Runs the BUILT extension in a real Chromium, the way a person uses it: open a page, press
 * "Check this page" in the side panel, read the result. Skipped where no Chromium is installed.
 */
describe.skipIf(!browserAvailable())('extension in Chromium', () => {
  let loaded: Loaded;
  let server: Server;
  let base = '';

  beforeAll(async () => {
    const fake = mkdtempSync(join(tmpdir(), 'isitreal-fake-'));
    for (const model of [IMAGE_CLASSIFIER_MODEL, PHOTO_GATE_MODEL])
      writeFileSync(join(fake, model.file), 'not a model');
    ({ server, base } = await startServer({ '/fake-models/': fake }));
    loaded = await launchWithExtension();
  }, 120_000);

  afterAll(async () => {
    await loaded?.context.close();
    server?.close();
  });

  it('warns about a scam page first, with reasons and advice', async () => {
    const { panel } = await loaded.openPanelFor(`${base}/scam-page.html`);
    await panel.getByRole('button', { name: 'Check this page' }).click();
    const scam = panel.locator('.scam');
    await expect.poll(() => scam.count(), { timeout: 30_000 }).toBe(1);
    expect(await scam.locator('.headline').innerText()).toContain(
      'Warning: this page looks like a scam.',
    );
    expect(await scam.locator('.reasons li').count()).toBeGreaterThan(0);
    expect(await scam.locator('.reasons li').count()).toBeLessThanOrEqual(3);
    expect(await scam.locator('.advice li').first().innerText()).toContain('Do not pay');
    // The scam card comes before anything about AI.
    expect(await panel.locator('.result > section').first().getAttribute('class')).toContain(
      'scam',
    );
    expect(await panel.getByRole('button', { name: 'Check again' }).count()).toBe(1);
  }, 60_000);

  it('takes the result away when the person goes to another page', async () => {
    const { page, panel } = await loaded.openPanelFor(`${base}/scam-page.html`);
    await panel.getByRole('button', { name: 'Check this page' }).click();
    await expect.poll(() => panel.locator('.scam').count(), { timeout: 30_000 }).toBe(1);
    await page.goto(`${base}/calm-page.html`);
    // The scam warning must not stay on screen for the page that was not checked.
    await expect.poll(() => panel.locator('.scam').count(), { timeout: 15_000 }).toBe(0);
    expect(await panel.locator('#status').innerText()).toContain('different page');
    expect(await panel.getByRole('button', { name: 'Check this page' }).count()).toBe(1);
    // And the new page can be checked.
    await panel.getByRole('button', { name: 'Check this page' }).click();
    await expect.poll(() => panel.locator('.scam-none').count(), { timeout: 30_000 }).toBe(1);
  }, 90_000);

  it('checks the pictures on the page and skips icons', async () => {
    const { panel } = await loaded.openPanelFor(`${base}/scam-page.html`);
    await panel.getByRole('button', { name: 'Check this page' }).click();
    await expect
      .poll(() => panel.locator('.ai .card').count(), { timeout: 30_000 })
      .toBeGreaterThan(0);
    const text = await panel.locator('.ai').innerText();
    // Three real pictures: the picture shown as a 16-pixel icon and the broken one are not content.
    expect(text).not.toContain('Picture 4');
    // The signed AI picture is named first, with the reason from its Content Credentials.
    const first = panel.locator('.ai .card').first();
    expect(await first.locator('.card-title').innerText()).toContain('Picture 2: Made with AI');
    expect(await first.innerText()).toContain(
      'Its digital signature (Content Credentials) says an AI tool made it.',
    );
    expect(await first.innerText()).toContain('Signed by: C2PA Test Signing Cert');
    // The picture that was changed after signing is not called AI; the broken signature is named.
    expect(text).toContain('Picture 1: No clear signs');
    expect(text).toContain('the signature is broken or changed');
    expect(text).not.toContain('could not be checked in this browser');
    expect(text).toContain('does not prove that something is real or safe');
  }, 60_000);

  it('says nothing alarming about a calm page, and never says "safe" or "real" on its own', async () => {
    const { panel } = await loaded.openPanelFor(`${base}/calm-page.html`);
    await panel.getByRole('button', { name: 'Check this page' }).click();
    const scam = panel.locator('.scam');
    await expect.poll(() => scam.count(), { timeout: 30_000 }).toBe(1);
    expect(await scam.getAttribute('class')).toContain('scam-none');
    expect(await scam.locator('.headline').innerText()).toContain(
      'We did not find scam warning signs. Stay careful anyway.',
    );
    expect(await scam.locator('.advice').count()).toBe(0);
  }, 60_000);

  it('checks video files for a signature, and says what it could not check', async () => {
    const { panel } = await loaded.openPanelFor(`${base}/video-page.html`);
    await panel.getByRole('button', { name: 'Check this page' }).click();
    await expect
      .poll(() => panel.locator('.ai .card').count(), { timeout: 30_000 })
      .toBeGreaterThan(1);
    const text = await panel.locator('.ai').innerText();
    expect(text).toContain('Video 1: Made with AI');
    expect(text).toContain('Its digital signature (Content Credentials) says an AI tool made it.');
    expect(text).toContain('Video 2: No clear signs');
    // Without the picture check, frames are not looked at, and the panel says so.
    expect(text).toContain('only the labels and the signature of this video were checked');
  }, 60_000);

  it('reads frames from a playing, streamed video without touching it', async () => {
    const { page, panel } = await loaded.openPanelFor(`${base}/stream-page.html`);
    await page.waitForFunction(
      () => (document.getElementById('player') as HTMLVideoElement).currentTime > 0.2,
    );
    const tabId = Number(new URL(panel.url()).searchParams.get('tabId'));
    // Ask the page reader for four frames, as the side panel does.
    const got = await panel.evaluate(
      (tab) =>
        new Promise<{ sizes: string[]; times: number[]; lengths: number[]; problem?: string }>(
          (resolve) => {
            const out = { sizes: [] as string[], times: [] as number[], lengths: [] as number[] };
            const port = chrome.tabs.connect(tab, { name: 'isitreal-capture', frameId: 0 });
            port.onMessage.addListener(
              (event: {
                type: string;
                problem?: string;
                frame?: { width: number; height: number; time: number; planes: string };
              }) => {
                if (event.type === 'frame') {
                  out.sizes.push(`${event.frame!.width}x${event.frame!.height}`);
                  out.times.push(event.frame!.time);
                  out.lengths.push(atob(event.frame!.planes).length);
                } else resolve({ ...out, ...(event.problem ? { problem: event.problem } : {}) });
              },
            );
            port.postMessage({ type: 'start', index: 0, count: 4 });
          },
        ),
      tabId,
    );
    expect(got.problem).toBeUndefined();
    expect(got.sizes).toEqual(['320x240', '320x240', '320x240', '320x240']);
    // Raw planes: one full-size and two quarter-size, nothing else.
    expect(got.lengths).toEqual([115200, 115200, 115200, 115200]);
    // Four different moments of the video.
    expect(new Set(got.times.map((t) => t.toFixed(1))).size).toBe(4);
    // The video was not paused or moved.
    expect(
      await page.evaluate(() => (document.getElementById('player') as HTMLVideoElement).paused),
    ).toBe(false);
    // The page check sees a streamed video: labels only, and no file was fetched.
    await panel.getByRole('button', { name: 'Check this page' }).click();
    await expect
      .poll(() => panel.locator('.ai .card').count(), { timeout: 30_000 })
      .toBeGreaterThan(0);
    expect(await panel.locator('.ai').innerText()).toContain('sent in small pieces');
  }, 90_000);

  it('says when a video is paused instead of waiting forever', async () => {
    const { page, panel } = await loaded.openPanelFor(`${base}/stream-page.html`);
    await page.waitForFunction(
      () => (document.getElementById('player') as HTMLVideoElement).currentTime > 0.2,
    );
    await page.evaluate(() => (document.getElementById('player') as HTMLVideoElement).pause());
    const tabId = Number(new URL(panel.url()).searchParams.get('tabId'));
    const problem = await panel.evaluate(
      (tab) =>
        new Promise<string | undefined>((resolve) => {
          const port = chrome.tabs.connect(tab, { name: 'isitreal-capture', frameId: 0 });
          port.onMessage.addListener((event: { type: string; problem?: string }) => {
            if (event.type === 'done') resolve(event.problem);
          });
          port.postMessage({ type: 'start', index: 0, count: 4 });
        }),
      tabId,
    );
    expect(problem).toBe('paused');
  }, 60_000);

  it('marks the toolbar button quietly as pages open, and stops when switched off', async () => {
    const badgeOf = (url: string) =>
      loaded.worker.evaluate(async (u) => {
        const tab = (await chrome.tabs.query({ url: u }))[0]!;
        return {
          text: await chrome.action.getBadgeText({ tabId: tab.id! }),
          title: await chrome.action.getTitle({ tabId: tab.id! }),
        };
      }, url);
    const scam = await loaded.context.newPage();
    await scam.goto(`${base}/scam-page.html`);
    await expect
      .poll(async () => (await badgeOf(`${base}/scam-page.html`)).text, { timeout: 15_000 })
      .toBe('!');
    expect((await badgeOf(`${base}/scam-page.html`)).title).toContain('looks like a scam');
    const calm = await loaded.context.newPage();
    await calm.goto(`${base}/calm-page.html`);
    await calm.waitForTimeout(2500);
    expect(await badgeOf(`${base}/calm-page.html`)).toEqual({
      text: '',
      title: 'Is It Real? Check this page',
    });
    // Switched off in the side panel: the next page gets no mark.
    const { panel } = await loaded.openPanelFor(`${base}/calm-page.html`);
    await panel.getByRole('button', { name: 'Quiet checks while I browse' }).click();
    expect(
      await panel
        .getByRole('button', { name: 'Quiet checks while I browse' })
        .getAttribute('aria-pressed'),
    ).toBe('false');
    const again = await loaded.context.newPage();
    await again.goto(`${base}/scam-page.html?again`);
    await again.waitForTimeout(2500);
    expect((await badgeOf(`${base}/scam-page.html?again`)).text).toBe('');
    await panel.getByRole('button', { name: 'Quiet checks while I browse' }).click();
  }, 90_000);

  it('checks one picture chosen with a right-click', async () => {
    const { panel } = await loaded.openPanelFor(`${base}/calm-page.html`);
    // What the right-click menu does: leave the request for the panel.
    await loaded.worker.evaluate(
      (picture) => chrome.storage.session.set({ pendingPicture: picture }),
      { url: `${base}/c2pa/ai-declared.jpg`, pageUrl: `${base}/scam-page.html`, at: Date.now() },
    );
    await expect.poll(() => panel.locator('.ai .card').count(), { timeout: 30_000 }).toBe(1);
    const text = await panel.locator('.ai').innerText();
    expect(text).toContain('The picture you chose');
    expect(text).toContain('This picture: Made with AI');
    // Only the picture is reported: no scam card for a page that was not checked.
    expect(await panel.locator('.scam').count()).toBe(0);
    // The request is used once.
    expect(
      await loaded.worker.evaluate(async () => Object.keys(await chrome.storage.session.get(null))),
    ).toEqual([]);
    // The menu entry exists for pictures.
    expect(await loaded.worker.evaluate(() => chrome.runtime.getManifest().permissions)).toContain(
      'contextMenus',
    );
  }, 60_000);

  it('finds a site label far down a long page', async () => {
    // The label matcher only knows real platforms, so the page is read as if it were one: the
    // page reader is asked directly what it found.
    const { panel } = await loaded.openPanelFor(`${base}/label-page.html`);
    const tabId = Number(new URL(panel.url()).searchParams.get('tabId'));
    const answer = await panel.evaluate(
      (tab) =>
        chrome.tabs.sendMessage(tab, { type: 'extract-page' }, { frameId: 0 }) as Promise<{
          page: { pageLabels: string[] };
        }>,
      tabId,
    );
    expect(answer.page.pageLabels).toEqual(['AI info']);
  }, 60_000);

  it('refuses model files that are not the genuine ones', async () => {
    // A folder with files of the right names and the wrong content.
    await loaded.worker.evaluate(
      (url) => chrome.storage.local.set({ modelBaseUrl: url }),
      `${base}/fake-models`,
    );
    const { panel } = await loaded.openPanelFor(`${base}/calm-page.html`);
    await expect
      .poll(() => panel.locator('#setup-text').innerText(), { timeout: 15_000 })
      .toContain('Not set up yet');
    await panel.getByRole('button', { name: 'Set up the picture check' }).click();
    await expect
      .poll(() => panel.locator('#setup-text').innerText(), { timeout: 30_000 })
      .toContain('The download did not finish');
    expect(await panel.getByRole('button', { name: 'Try again' }).isVisible()).toBe(true);
    // Nothing was kept: a check still runs, without the picture model.
    await panel.getByRole('button', { name: 'Check this page' }).click();
    await expect.poll(() => panel.locator('.scam').count(), { timeout: 30_000 }).toBe(1);
    await loaded.worker.evaluate(() => chrome.storage.local.remove('modelBaseUrl'));
  }, 90_000);

  it('explains when a page cannot be checked', async () => {
    const panel = await loaded.context.newPage();
    const other = await loaded.context.newPage();
    await other.goto('about:blank');
    // A browser page (no web address the extension may read), and a tab that does not exist.
    const blank = await loaded.worker.evaluate(
      async () => (await chrome.tabs.query({})).filter((t) => t.url === undefined).at(-1)!.id!,
    );
    for (const tabId of [blank, -1]) {
      await panel.goto(`chrome-extension://${loaded.extensionId}/sidepanel.html?tabId=${tabId}`);
      await panel.getByRole('button', { name: 'Check this page' }).click();
      await expect
        .poll(() => panel.locator('#status').innerText(), { timeout: 15_000 })
        .toContain('cannot be checked');
    }
  }, 60_000);
});
