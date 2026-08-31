const { test, expect } = require('@playwright/test');

test('portrait mobile gives drink/coaster groups a visible tabletop footprint', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto('/index.html');
  await page.waitForFunction(() => window.SHITHEAD_BUILD === '0.9.25');
  await page.waitForFunction(() => !!document.querySelector('.self-beer-mat .beer-mat-drink-asset'));

  const self = page.locator('.self-beer-mat');
  const left = page.locator('.seat-left .opponent-beer-mat');
  const right = page.locator('.seat-right .opponent-beer-mat');

  await expect(self).toBeVisible();
  await expect(left).toBeVisible();
  await expect(right).toBeVisible();

  const sizes = await page.evaluate(() => ({
    self: document.querySelector('.self-beer-mat').getBoundingClientRect().width,
    left: document.querySelector('.seat-left .opponent-beer-mat').getBoundingClientRect().width,
    right: document.querySelector('.seat-right .opponent-beer-mat').getBoundingClientRect().width,
    selfDrink: document.querySelector('.self-beer-mat .beer-mat-drink-asset').getBoundingClientRect().width,
  }));

  expect(sizes.self).toBeGreaterThanOrEqual(70);
  expect(sizes.left).toBeGreaterThanOrEqual(62);
  expect(sizes.right).toBeGreaterThanOrEqual(62);
  expect(sizes.selfDrink).toBeGreaterThan(80);

  await context.close();
});
