const { test, expect } = require('@playwright/test');
const fs = require('node:fs');

const OUT = 'visual-audit';

async function waitForArtwork(page) {
  await page.goto('/index.html');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForFunction(() => window.SHITHEAD_BUILD === '0.9.22');
  await page.waitForFunction(() => !!window.ShitHeadTableAssets0922);
  await page.waitForFunction(() => document.querySelectorAll('.beer-mat').length === 3);
  await expect.poll(async () => page.locator('.beer-mat.assets-ready').count()).toBe(3);
  await expect(page.locator('.player-snack-bowl')).toHaveCount(1);
}

async function setTheme(page, theme) {
  await page.evaluate((nextTheme) => {
    document.body.dataset.theme = nextTheme;
    if (typeof render === 'function') render();
  }, theme);
  await page.waitForTimeout(250);
}

test('capture Build 0.9.22 desktop tabletop assets', async ({ page }) => {
  fs.mkdirSync(OUT, { recursive: true });
  await waitForArtwork(page);

  for (const theme of ['kitchen', 'pub', 'casino']) {
    await setTheme(page, theme);
    await page.screenshot({ path: `${OUT}/${theme}-1440x1000.png`, fullPage: true });
  }

  await setTheme(page, 'kitchen');
  const selfCoaster = page.locator('.self-beer-mat');
  await expect(selfCoaster).toBeVisible();
  await selfCoaster.click();
  await expect(page.locator('.drink-picker')).toBeVisible();
  await page.screenshot({ path: `${OUT}/drink-picker-1440x1000.png`, fullPage: true });
});
