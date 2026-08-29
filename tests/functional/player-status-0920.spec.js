const { test, expect } = require('@playwright/test');

test('drink-only coasters and player notepads render with public risk', async ({ page }) => {
  await page.goto('/index.html');
  await page.waitForFunction(() => window.SHITHEAD_BUILD === '0.9.21' && !!window.ShitHeadPublicRiskV1);
  await page.waitForFunction(() => !!document.querySelector('script[src*="player-status-rounding-0921.js"]'));

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
  expect(numeric.reduce((sum, value) => sum + value, 0)).toBe(100);

  const selfCoaster = page.locator('.self-beer-mat');
  await expect(selfCoaster).toBeVisible();
  await selfCoaster.click();
  const coffee = page.locator('.drink-picker-option[data-drink="coffee"]');
  await expect(coffee).toBeVisible();
  await coffee.click();
  await expect(page.locator('.self-beer-mat .beer-mat-drink')).toHaveText('☕');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('shithead-drink-Oliver'))).toBe('coffee');
});

test('portrait mobile notepads stay readable and inside the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.SHITHEAD_BUILD === '0.9.21' && document.querySelectorAll('.player-notepad').length === 3);

  const pads = await page.locator('.player-notepad').evaluateAll((nodes) => nodes.map((node) => {
    const rect = node.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
  }));

  for (const pad of pads) {
    expect(pad.left).toBeGreaterThanOrEqual(0);
    expect(pad.right).toBeLessThanOrEqual(390);
    expect(pad.top).toBeGreaterThanOrEqual(0);
    expect(pad.width).toBeGreaterThan(85);
    expect(pad.height).toBeGreaterThan(55);
  }

  const selfPad = await page.locator('.seat-player .player-notepad').boundingBox();
  const setupActions = await page.locator('.setup-actions').boundingBox();
  expect(selfPad).not.toBeNull();
  expect(setupActions).not.toBeNull();
  expect(selfPad.y + selfPad.height).toBeLessThan(setupActions.y + 4);
});
