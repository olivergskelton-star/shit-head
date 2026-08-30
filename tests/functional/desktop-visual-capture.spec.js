const { test, expect } = require('@playwright/test');
const fs = require('node:fs');

const OUT = 'visual-audit';

async function waitForArtwork(page) {
  await page.goto('/index.html');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForFunction(() => window.SHITHEAD_BUILD === '0.9.22');
  await page.waitForFunction(() => !!window.ShitHeadTableAssets0922);
  await page.waitForFunction(() => document.querySelectorAll('.beer-mat').length === 3);
  const atlasLoaded = await page.evaluate(async () => !!(await window.ShitHeadTableAssets0922.loadAtlas()));
  await page.waitForTimeout(300);
  return {
    atlasLoaded,
    readyCoasters: await page.locator('.beer-mat.assets-ready').count(),
    totalCoasters: await page.locator('.beer-mat').count(),
    snackBowls: await page.locator('.player-snack-bowl').count(),
    drinkSprites: await page.locator('.beer-mat-drink-asset').count(),
    fallbackDrinks: await page.locator('.beer-mat-drink').count(),
  };
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
  const consoleLines = [];
  page.on('console', (msg) => consoleLines.push(`${msg.type()}: ${msg.text()}`));
  page.on('pageerror', (error) => consoleLines.push(`pageerror: ${error.message}`));

  const diagnostics = await waitForArtwork(page);
  fs.writeFileSync(`${OUT}/diagnostics.json`, JSON.stringify(diagnostics, null, 2));

  for (const theme of ['kitchen', 'pub', 'casino']) {
    await setTheme(page, theme);
    await page.screenshot({ path: `${OUT}/${theme}-1440x1000.png`, fullPage: true });
  }

  await setTheme(page, 'kitchen');
  const selfCoaster = page.locator('.self-beer-mat');
  await expect(selfCoaster).toBeVisible();
  await selfCoaster.click();
  if (await page.locator('.drink-picker').isVisible().catch(() => false)) {
    await page.screenshot({ path: `${OUT}/drink-picker-1440x1000.png`, fullPage: true });
  }

  fs.writeFileSync(`${OUT}/browser-console.txt`, consoleLines.join('\n'));
});
