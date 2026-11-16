import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IMAGE_CLASSIFIER_MODEL, PHOTO_GATE_MODEL } from '@isitreal/core';
import {
  asPostSite,
  browserAvailable,
  launchWithExtension,
  startServer,
  type Loaded,
} from './browser.js';

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
  }, 240_000);

  afterAll(async () => {
    await loaded?.close();
    server?.close();
  });

  it('warns about a scam page first, with reasons and advice', async () => {
    const { panel } = await loaded.openPanelFor(`${base}/scam-page.html`);
    await panel.getByRole('button', { name: 'Check this page' }).click();
    const scam = panel.locator('.scam');
    await expect.poll(() => scam.count(), { timeout: 90_000 }).toBe(1);
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
  }, 240_000);

  it('does not treat a time limit or one small sign as a scam warning', async () => {
    // Reported from real use: a video description "explained in 20 minutes" was marked.
    const dune = await loaded.openPanelFor(`${base}/video-description-page.html`);
    await dune.panel.getByRole('button', { name: 'Check this page' }).click();
    await expect.poll(() => dune.panel.locator('.scam').count(), { timeout: 90_000 }).toBe(1);
    expect(await dune.panel.locator('.scam').getAttribute('class')).toContain('scam-none');
    expect(await dune.panel.locator('.scam .reasons').count()).toBe(0);
    // One weak sign is named, calmly, and does not look like a warning.
    const small = await loaded.openPanelFor(`${base}/small-sign-page.html`);
    await small.panel.getByRole('button', { name: 'Check this page' }).click();
    const card = small.panel.locator('.scam');
    await expect.poll(() => card.count(), { timeout: 90_000 }).toBe(1);
    expect(await card.getAttribute('class')).toContain('scam-low');
    expect(await card.locator('.headline').innerText()).toContain(
      'One small sign was found. On its own it is not a reason to worry.',
    );
    expect(await card.locator('.advice').count()).toBe(0);
    const colours = (selector: string, panel: typeof small.panel) =>
      panel.evaluate((s) => getComputedStyle(document.querySelector(s)!).backgroundColor, selector);
    expect(await colours('.scam', small.panel)).toBe(await colours('.scam', dune.panel));
  }, 240_000);

  it('uses what the page itself says about a picture, as a hint and with the words quoted', async () => {
    // Reported from real use: pictures on an image generator's own site, named
    // "ai-generated-image-1.png", got no result at all.
    const { panel } = await loaded.openPanelFor(`${base}/claims-page.html`);
    await panel.getByRole('button', { name: 'Check this page' }).click();
    await expect
      .poll(() => panel.locator('.ai .card').count(), { timeout: 90_000 })
      .toBeGreaterThan(2);
    const text = await panel.locator('.ai').innerText();
    expect(text).toContain('Picture 1: Likely made with AI');
    expect(text).toContain('The file is named: “ai-generated-image-1.jpg”');
    expect(text).toContain('Picture 2: Likely made with AI');
    expect(text).toContain('Written next to it: “AI-generated image of a mountain lake”');
    expect(text).toContain('That is the word of whoever posted it, not a signed record.');
    // Never "Made with AI": that is kept for signatures and platform labels.
    expect(text).not.toContain('Made with AI\n');
    // The team photo sits next to the words "AI image generator", which say nothing about it.
    expect(text).toContain('Picture 3: No clear signs');
  }, 240_000);

  it("reads one post's page the way a person sees it", async () => {
    // Reported from real use (Instagram): the pictures checked were stills of other reels far
    // down the feed, a still under a playing video looked like a separate picture, and a caption
    // saying "ai generated video" was not mentioned anywhere.
    const address = `${asPostSite(base)}/p/post-page/`;
    const { panel } = await loaded.openPanelFor(address);
    const tabId = Number(new URL(panel.url()).searchParams.get('tabId'));
    const answer = await panel.evaluate(
      (tab) =>
        chrome.tabs.sendMessage(tab, { type: 'extract-page' }, { frameId: 0 }) as Promise<{
          page: {
            videoPage: boolean;
            pageWords: string[];
            images: { url: string; stillOfVideo?: boolean }[];
          };
        }>,
      tabId,
    );
    expect(answer.page.videoPage).toBe(true);
    // Pictures on screen come before one that is first in the page's code but far below.
    expect(answer.page.images.map((i) => i.url.split('/').pop())).toEqual([
      'still.jpg',
      'on-screen.jpg',
      'far-down.jpg',
    ]);
    expect(answer.page.images.map((i) => i.stillOfVideo === true)).toEqual([true, false, false]);
    // A caption and tags are picked up; the words of a link to another post are not.
    expect(answer.page.pageWords).toEqual([
      'ai generated video 🥰',
      '#ai',
      '#aislop',
      'Is this AI generated?',
      'Meta AI',
    ]);

    await panel.getByRole('button', { name: 'Check this page' }).click();
    await expect.poll(() => panel.locator('.page-says').count(), { timeout: 90_000 }).toBe(1);
    const said = await panel.locator('.page-says').innerText();
    expect(said).toContain('Written on this page');
    expect(said).toContain('“ai generated video 🥰”');
    expect(said).toContain('“#aislop”');
    // A bare "#ai" is about the topic; a question and a product name are not statements that
    // something was made with AI.
    expect(said).not.toContain('“#ai”');
    expect(said).not.toContain('Is this');
    expect(said).not.toContain('Meta AI');
    expect(said).toContain('We cannot tell who wrote them');
    const text = await panel.locator('.ai').innerText();
    // The words change no result: nothing here is called AI-made because of them.
    expect(text).not.toContain('Likely made with AI');
    expect(text).toContain('still picture shown for a video');
  }, 240_000);

  it('saves a report with the numbers behind the result, on request', async () => {
    const { panel } = await loaded.openPanelFor(`${base}/scam-page.html`);
    expect(
      await panel.getByRole('button', { name: 'Save a report for the developer' }).count(),
    ).toBe(0);
    await panel.getByRole('button', { name: 'Check this page' }).click();
    await expect.poll(() => panel.locator('.scam').count(), { timeout: 90_000 }).toBe(1);
    const download = panel.waitForEvent('download');
    await panel.getByRole('button', { name: 'Save a report for the developer' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^is-it-real-report-[\d-]+\.json$/);
    const report = JSON.parse(readFileSync(await file.path(), 'utf8')) as {
      page: string;
      extension: string;
      pictureCheckFiles: string;
      cutOffs: { picture: number; videoFile: number; videoPlaying: number };
      scam: { risk: string; reasons: { code: string; evidence?: string }[] };
      labelLikeTextsOnPage: string[];
      items: {
        kind: string;
        source: string;
        outcome: string;
        reasons: string[];
        textsNextToIt?: string[];
      }[];
    };
    expect(report.page).toBe(`${base}/scam-page.html`);
    // Picture addresses are saved without what follows the "?" (often a key to the file).
    for (const item of report.items) expect(item.source).not.toMatch(/[?#]/);
    expect(report.pictureCheckFiles).toBe('absent');
    expect(report.cutOffs.picture).toBeGreaterThan(5);
    expect(report.cutOffs.videoPlaying).toBeGreaterThan(report.cutOffs.videoFile);
    expect(report.scam.risk).toBe('high');
    expect(report.scam.reasons[0]!.evidence).toBeTruthy();
    expect(report.items.filter((i) => i.kind === 'image')).toHaveLength(3);
    // What the page reader saw as possible site labels, and the texts next to each picture.
    expect(Array.isArray(report.labelLikeTextsOnPage)).toBe(true);
    expect(report.items.find((i) => i.outcome === 'verified_ai')!.textsNextToIt).toContain(
      'Our agent',
    );
    expect(report.items.find((i) => i.outcome === 'verified_ai')!.reasons).toContain(
      'c2pa_declares_ai',
    );
    // Addresses and results only: the page's own sentences are not in the file.
    expect(JSON.stringify(report)).not.toContain('closed for good');
    expect(await panel.locator('#status').innerText()).toContain('report was saved');
  }, 240_000);

  it('takes the result away when the person goes to another page', async () => {
    const { page, panel } = await loaded.openPanelFor(`${base}/scam-page.html`);
    await panel.getByRole('button', { name: 'Check this page' }).click();
    await expect.poll(() => panel.locator('.scam').count(), { timeout: 90_000 }).toBe(1);
    await page.goto(`${base}/calm-page.html`);
    // The scam warning must not stay on screen for the page that was not checked.
    await expect.poll(() => panel.locator('.scam').count(), { timeout: 60_000 }).toBe(0);
    expect(await panel.locator('#status').innerText()).toContain('different page');
    expect(await panel.getByRole('button', { name: 'Check this page' }).count()).toBe(1);
    // And the new page can be checked.
    await panel.getByRole('button', { name: 'Check this page' }).click();
    await expect.poll(() => panel.locator('.scam-none').count(), { timeout: 90_000 }).toBe(1);
  }, 240_000);

  it('checks the pictures on the page and skips icons', async () => {
    const { panel } = await loaded.openPanelFor(`${base}/scam-page.html`);
    await panel.getByRole('button', { name: 'Check this page' }).click();
    await expect
      .poll(() => panel.locator('.ai .card').count(), { timeout: 90_000 })
      .toBeGreaterThan(0);
    const text = await panel.locator('.ai').innerText();
    // Three real pictures: the picture shown as a 16-pixel icon, the broken one and the vector
    // drawing (SVG) are not content.
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
  }, 240_000);

  it('says nothing alarming about a calm page, and never says "safe" or "real" on its own', async () => {
    const { panel } = await loaded.openPanelFor(`${base}/calm-page.html`);
    await panel.getByRole('button', { name: 'Check this page' }).click();
    const scam = panel.locator('.scam');
    await expect.poll(() => scam.count(), { timeout: 90_000 }).toBe(1);
    expect(await scam.getAttribute('class')).toContain('scam-none');
    expect(await scam.locator('.headline').innerText()).toContain(
      'We did not find scam warning signs. Stay careful anyway.',
    );
    expect(await scam.locator('.advice').count()).toBe(0);
  }, 240_000);

  it('checks video files for a signature, and says what it could not check', async () => {
    const { panel } = await loaded.openPanelFor(`${base}/video-page.html`);
    await panel.getByRole('button', { name: 'Check this page' }).click();
    await expect
      .poll(() => panel.locator('.ai .card').count(), { timeout: 90_000 })
      .toBeGreaterThan(1);
    const text = await panel.locator('.ai').innerText();
    expect(text).toContain('Video 1: Made with AI');
    expect(text).toContain('Its digital signature (Content Credentials) says an AI tool made it.');
    expect(text).toContain('Video 2: No clear signs');
    // Without the picture check, frames are not looked at, and the panel says so.
    expect(text).toContain('only the labels and the signature of this video were checked');
  }, 240_000);

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
      .poll(() => panel.locator('.ai .card').count(), { timeout: 90_000 })
      .toBeGreaterThan(0);
    expect(await panel.locator('.ai').innerText()).toContain('streamed in small pieces');
  }, 240_000);

  it('watches the video that is playing, not a loaded one that has not started', async () => {
    // Reported from real use: on a Facebook reel the check said "the video is not playing".
    // Reel pages keep the next clip loaded at the same size; it was picked instead.
    const { page, panel } = await loaded.openPanelFor(`${base}/two-videos-page.html`);
    await page.waitForFunction(
      () => (document.getElementById('current') as HTMLVideoElement).currentTime > 0.2,
    );
    const tabId = Number(new URL(panel.url()).searchParams.get('tabId'));
    for (const index of [0, 1]) {
      const got = await panel.evaluate(
        ([tab, wanted]) =>
          new Promise<{ frames: number; problem?: string }>((resolve) => {
            let frames = 0;
            const port = chrome.tabs.connect(tab!, { name: 'isitreal-capture', frameId: 0 });
            port.onMessage.addListener((event: { type: string; problem?: string }) => {
              if (event.type === 'frame') frames++;
              else resolve({ frames, ...(event.problem ? { problem: event.problem } : {}) });
            });
            port.postMessage({ type: 'start', index: wanted, count: 2 });
          }),
        [tabId, index] as const,
      );
      expect(got, `asked for video ${index}`).toEqual({ frames: 2 });
    }
  }, 240_000);

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
  }, 240_000);

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
      .poll(async () => (await badgeOf(`${base}/scam-page.html`)).text, { timeout: 60_000 })
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
  }, 240_000);

  it('checks one picture chosen with a right-click', async () => {
    const { panel } = await loaded.openPanelFor(`${base}/calm-page.html`);
    // What the right-click menu does: leave the request for the panel.
    await loaded.worker.evaluate(
      (picture) => chrome.storage.session.set({ pendingPicture: picture }),
      { url: `${base}/c2pa/ai-declared.jpg`, pageUrl: `${base}/scam-page.html`, at: Date.now() },
    );
    await expect.poll(() => panel.locator('.ai .card').count(), { timeout: 90_000 }).toBe(1);
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
  }, 240_000);

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
  }, 240_000);

  it('refuses model files that are not the genuine ones', async () => {
    // A folder with files of the right names and the wrong content.
    await loaded.worker.evaluate(
      (url) => chrome.storage.local.set({ modelBaseUrl: url }),
      `${base}/fake-models`,
    );
    const { panel } = await loaded.openPanelFor(`${base}/calm-page.html`);
    await expect
      .poll(() => panel.locator('#setup-text').innerText(), { timeout: 60_000 })
      .toContain('Not set up yet');
    await panel.getByRole('button', { name: 'Set up the picture check' }).click();
    await expect
      .poll(() => panel.locator('#setup-text').innerText(), { timeout: 90_000 })
      .toContain('The download did not finish');
    expect(await panel.getByRole('button', { name: 'Try again' }).isVisible()).toBe(true);
    // Nothing was kept: a check still runs, without the picture model.
    await panel.getByRole('button', { name: 'Check this page' }).click();
    await expect.poll(() => panel.locator('.scam').count(), { timeout: 90_000 }).toBe(1);
    await loaded.worker.evaluate(() => chrome.storage.local.remove('modelBaseUrl'));
  }, 240_000);

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
        .poll(() => panel.locator('#status').innerText(), { timeout: 60_000 })
        .toContain('cannot be checked');
    }
  }, 240_000);
});
