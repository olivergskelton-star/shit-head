const { test, expect } = require('@playwright/test');

test('drink-only coasters and player notepads render with public risk', async ({ page }) => {
  await page.goto('/index.html');
  await page.waitForFunction(() => window.SHITHEAD_BUILD === '0.9.20' && !!window.ShitHeadPublicRiskV1);

  await expect(page.locator('.player-notepad')).toHaveCount(3);
  await expect(page.locator('.beer-mat')).toHaveCount(3);
  await expect(page.locator('.beer-mat .beer-mat-score')).toHaveCount(0);
  await expect(page.locator('.beer-mat .beer-mat-name-ring')).toHaveCount(0);

  const notes = page.locator('.player-notepad');
  await expect(notes.first()).toContainText('Score');
  await expect(notes.first()).toContainText('Shithead');

  const risks = await page.locator('.player-notepad .notepad-risk .notepad-value').allTextContents();
  const numeric = risks.map((value) => Number(value.replace('%', '')));
  expect(numeric.every(Number.isFinite)).toBe(true);
  expect(numeric.reduce((sum, value) => sum + value, 0)).toBeGreaterThanOrEqual(99);
  expect(numeric.reduce((sum, value) => sum + value, 0)).toBeLessThanOrEqual(101);

  const selfCoaster = page.locator('.self-beer-mat');
  await expect(selfCoaster).toBeVisible();
  await selfCoaster.click();
  const coffee = page.locator('.drink-picker-option[data-drink="coffee"]');
  await expect(coffee).toBeVisible();
  await coffee.click();
  await expect(page.locator('.self-beer-mat .beer-mat-drink')).toHaveText('☕');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('shithead-drink-Oliver'))).toBe('coffee');
});
