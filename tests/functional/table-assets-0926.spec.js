const { test, expect } = require('@playwright/test');

test('real direct drink artwork stays visible in picker and after drink re-render', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1150, height: 870 } });
  const page = await context.newPage();
  await page.goto('/index.html');

  await page.waitForFunction(() => window.SHITHEAD_BUILD === '0.9.26' && !!window.ShitHeadTableAssets0922);
  await page.evaluate(() => window.ShitHeadTableAssets0922.loadAssets());
  await page.waitForFunction(() => document.documentElement.dataset.tableAssets === 'ready');

  await page.waitForFunction(() => {
    const mats = [...document.querySelectorAll('.beer-mat')];
    return mats.length === 3 && mats.every((mat) => {
      const coaster = mat.querySelector('.beer-mat-coaster-asset .asset-direct-image');
      const drink = mat.querySelector('.beer-mat-drink-asset .asset-direct-image');
      return mat.classList.contains('assets-ready')
        && coaster?.complete && coaster.naturalWidth > 0
        && drink?.complete && drink.naturalWidth > 0;
    });
  });

  const self = page.locator('.self-beer-mat');
  await expect(self).toBeVisible();
  await self.click();

  const options = page.locator('.drink-picker-option');
  await expect(options).toHaveCount(14);
  await page.waitForFunction(() => [...document.querySelectorAll('.drink-picker-option')].every((option) => {
    const image = option.querySelector('.asset-direct-image');
    return image?.complete && image.naturalWidth > 0;
  }));

  const guinness = page.locator('.drink-picker-option[data-drink="guinness"]');
  await expect(guinness.locator('.asset-direct-image')).toBeVisible();
  await guinness.click();

  await expect(page.locator('.self-beer-mat')).toHaveAttribute('data-drink', 'guinness');
  await page.waitForFunction(() => [...document.querySelectorAll('.beer-mat')].every((mat) => {
    const coaster = mat.querySelector('.beer-mat-coaster-asset .asset-direct-image');
    const drink = mat.querySelector('.beer-mat-drink-asset .asset-direct-image');
    return mat.classList.contains('assets-ready')
      && coaster?.complete && coaster.naturalWidth > 0
      && drink?.complete && drink.naturalWidth > 0;
  }));

  await expect(page.locator('.self-beer-mat .asset-direct-fallback')).toBeHidden();

  const atlasWasRequested = await page.evaluate(() => performance.getEntriesByType('resource')
    .some((entry) => entry.name.includes('/assets/atlas/')));
  expect(atlasWasRequested).toBeFalsy();

  await context.close();
});
