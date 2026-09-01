const { test, expect } = require('@playwright/test');

test('portrait mobile gives drink/coaster groups a visible tabletop footprint', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto('/index.html');

  // This regression protects the 0.9.25 mobile layout contract. It must keep
  // running on later builds rather than pinning the entire app to 0.9.25.
  await page.waitForFunction(() => (
    !!window.SHITHEAD_BUILD
    && !!document.querySelector('.self-beer-mat')
    && !!document.querySelector('.seat-left .opponent-beer-mat')
    && !!document.querySelector('.seat-right .opponent-beer-mat')
  ));

  const self = page.locator('.self-beer-mat');
  const left = page.locator('.seat-left .opponent-beer-mat');
  const right = page.locator('.seat-right .opponent-beer-mat');

  await expect(self).toBeVisible();
  await expect(left).toBeVisible();
  await expect(right).toBeVisible();

  const metrics = await page.evaluate(() => {
    const selfMat = document.querySelector('.self-beer-mat');
    const leftMat = document.querySelector('.seat-left .opponent-beer-mat');
    const rightMat = document.querySelector('.seat-right .opponent-beer-mat');
    const cssLoaded = [...document.styleSheets].some((sheet) => (
      String(sheet.href || '').includes('mobile-drinks-0925.css')
    ));

    return {
      cssLoaded,
      self: selfMat.getBoundingClientRect().width,
      left: leftMat.getBoundingClientRect().width,
      right: rightMat.getBoundingClientRect().width,
      selfScale: getComputedStyle(selfMat).getPropertyValue('--seat-drink-scale').trim(),
      leftScale: getComputedStyle(leftMat).getPropertyValue('--seat-drink-scale').trim(),
      selfTransform: getComputedStyle(selfMat.closest('.self-identity-row')).transform,
    };
  });

  expect(metrics.cssLoaded).toBe(true);
  expect(metrics.self).toBeGreaterThanOrEqual(70);
  expect(metrics.left).toBeGreaterThanOrEqual(62);
  expect(metrics.right).toBeGreaterThanOrEqual(62);
  expect(metrics.selfScale).toBe('1.12');
  expect(metrics.leftScale).toBe('1.02');
  expect(metrics.selfTransform).toBe('none');

  await context.close();
});
