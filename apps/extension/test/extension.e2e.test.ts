import { spawnSync } from 'node:child_process';
import type { Server } from 'node:http';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  browserAvailable,
  launchWithExtension,
  root,
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
    const built = spawnSync(process.execPath, [join(root, 'apps', 'extension', 'build.mjs')], {
      encoding: 'utf8',
    });
    if (built.status !== 0) throw new Error(built.stderr);
    ({ server, base } = await startServer());
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
