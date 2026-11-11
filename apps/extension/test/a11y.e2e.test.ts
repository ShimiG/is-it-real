import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { createRequire } from 'node:module';
import type { Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { browserAvailable, launchWithExtension, startServer, type Loaded } from './browser.js';

/**
 * Accessibility of the side panel, checked in a real Chromium (PLAN.md section 7): an automated
 * WCAG audit (axe-core) in every state a person meets, plus the things an audit cannot see:
 * keyboard use, text size, and where the reading position goes after a check.
 */
const axeSource = readFileSync(
  createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
  'utf8',
);

interface Violation {
  id: string;
  impact: string | null;
  help: string;
  nodes: { target: string[]; failureSummary?: string }[];
}

async function audit(page: Page): Promise<string[]> {
  await page.evaluate(axeSource);
  const violations = (await page.evaluate(async () => {
    const axe = (
      window as unknown as { axe: { run(o: unknown): Promise<{ violations: unknown[] }> } }
    ).axe;
    const result = await axe.run({
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
      },
    });
    return result.violations;
  })) as Violation[];
  return violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.help} at ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
  );
}

describe.skipIf(!browserAvailable())('side panel accessibility', () => {
  let loaded: Loaded;
  let server: Server;
  let base = '';

  beforeAll(async () => {
    ({ server, base } = await startServer());
    loaded = await launchWithExtension();
  }, 120_000);

  afterAll(async () => {
    await loaded?.context.close();
    server?.close();
  });

  const checked = async (url: string, scheme: 'light' | 'dark' = 'light') => {
    const { panel } = await loaded.openPanelFor(url);
    await panel.emulateMedia({ colorScheme: scheme });
    await panel.setViewportSize({ width: 380, height: 900 });
    await panel.getByRole('button', { name: 'Check this page' }).click();
    await expect.poll(() => panel.locator('.scam').count(), { timeout: 30_000 }).toBe(1);
    return panel;
  };

  it('passes the audit before a check, in light and dark colours', async () => {
    const { panel } = await loaded.openPanelFor(`${base}/calm-page.html`);
    await expect
      .poll(() => panel.locator('#setup-text').innerText(), { timeout: 15_000 })
      .not.toBe('');
    expect(await audit(panel)).toEqual([]);
    await panel.emulateMedia({ colorScheme: 'dark' });
    expect(await audit(panel)).toEqual([]);
  }, 60_000);

  it('passes the audit with a scam warning and picture results, in light and dark colours', async () => {
    expect(await audit(await checked(`${base}/scam-page.html`))).toEqual([]);
    expect(await audit(await checked(`${base}/scam-page.html`, 'dark'))).toEqual([]);
  }, 120_000);

  it('passes the audit with video results and in large-text mode', async () => {
    const panel = await checked(`${base}/video-page.html`);
    await panel.getByRole('button', { name: 'Larger text' }).click();
    expect(await audit(panel)).toEqual([]);
    // Large text must not push anything off the side of a narrow panel.
    const overflow = await panel.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await panel.getByRole('button', { name: 'Larger text' }).click();
  }, 120_000);

  it('uses text of 18 pixels or more, 22 in large-text mode, and remembers the choice', async () => {
    const panel = await checked(`${base}/scam-page.html`);
    const smallest = () =>
      panel.evaluate(() => {
        let min = Infinity;
        for (const el of document.querySelectorAll<HTMLElement>('body *')) {
          const hasText = [...el.childNodes].some(
            (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '',
          );
          if (!hasText || el.offsetParent === null) continue;
          min = Math.min(min, parseFloat(getComputedStyle(el).fontSize));
        }
        return min;
      });
    expect(await smallest()).toBeGreaterThanOrEqual(18);
    await panel.getByRole('button', { name: 'Larger text' }).click();
    expect(await smallest()).toBeGreaterThanOrEqual(22);
    // The choice is kept for next time.
    await panel.reload();
    await expect
      .poll(() => panel.getByRole('button', { name: 'Larger text' }).getAttribute('aria-pressed'))
      .toBe('true');
    await panel.getByRole('button', { name: 'Larger text' }).click();
  }, 120_000);

  it('can be used with the keyboard alone, and moves to the result after a check', async () => {
    const { panel } = await loaded.openPanelFor(`${base}/scam-page.html`);
    await panel.locator('body').focus();
    await panel.keyboard.press('Tab');
    // The first stop is the main button, and it shows a focus ring.
    expect(await panel.evaluate(() => document.activeElement?.id)).toBe('check');
    const ring = await panel.evaluate(() => getComputedStyle(document.activeElement!).outlineWidth);
    expect(parseFloat(ring)).toBeGreaterThanOrEqual(3);
    await panel.keyboard.press('Enter');
    await expect.poll(() => panel.locator('.scam').count(), { timeout: 30_000 }).toBe(1);
    // After the check, reading continues at the result, not back at the top.
    expect(await panel.evaluate(() => document.activeElement?.id)).toBe('results');
    // Every control can be reached with Tab, and each has a name.
    const names: string[] = [];
    for (let i = 0; i < 12; i++) {
      await panel.keyboard.press('Tab');
      const name = await panel.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return el === null || el === document.body
          ? ''
          : (el.innerText || el.getAttribute('aria-label') || '').trim();
      });
      if (name !== '') names.push(name);
    }
    expect(names).toEqual(
      expect.arrayContaining([
        'Set up the picture check',
        'Read the result aloud',
        'Larger text',
        'Quiet checks while I browse',
      ]),
    );
    // Buttons are big enough to hit (at least 44 pixels high).
    const heights = await panel.evaluate(() =>
      [...document.querySelectorAll('button')]
        .filter((b) => b.offsetParent !== null)
        .map((b) => b.getBoundingClientRect().height),
    );
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(44);
  }, 120_000);
});
