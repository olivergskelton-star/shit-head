const fs = require('node:fs');
const { test, expect } = require('@playwright/test');

test('desktop branding, foreground drink, snack and opponent notes match Build 0.9.31', async ({ page }) => {
  await page.setViewportSize({ width: 1150, height: 900 });
  await page.goto('/index.html');
  await page.waitForFunction(() => (
    window.SHITHEAD_BUILD === '0.9.31'
    && document.documentElement.dataset.tableAssets === 'ready'
    && document.querySelectorAll('.player-notepad').length === 3
  ));

  await expect(page.locator('.topbar h1')).toHaveText('S**t Head');

  const proportions = await page.evaluate(() => ({
    selfDrinkScale: Number.parseFloat(getComputedStyle(document.querySelector('.self-beer-mat')).getPropertyValue('--seat-drink-scale')),
    opponentDrinkScale: Number.parseFloat(getComputedStyle(document.querySelector('.opponent-beer-mat')).getPropertyValue('--seat-drink-scale')),
    snackWidth: document.querySelector('.player-snack-bowl').getBoundingClientRect().width,
  }));
  expect(proportions.selfDrinkScale).toBeGreaterThan(proportions.opponentDrinkScale);
  expect(proportions.selfDrinkScale).toBeCloseTo(1.24, 2);
  expect(proportions.snackWidth).toBeGreaterThanOrEqual(145);

  for (const side of ['left', 'right']) {
    const geometry = await page.locator(`.seat-${side}`).evaluate((seat) => {
      const note = seat.querySelector('.player-notepad').getBoundingClientRect();
      const cards = seat.querySelector('.opponent-card-cluster').getBoundingClientRect();
      return { noteBottom: note.bottom, cardsTop: cards.top };
    });
    expect(geometry.noteBottom).toBeLessThan(geometry.cardsTop);
  }

  fs.mkdirSync('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/desktop-final.png', fullPage: true });
});
