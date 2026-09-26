const { test, expect } = require('@playwright/test');
const fs = require('node:fs');

test('mobile four-player table keeps cards, drinks and controls separate through setup and play', async ({ page }) => {
  await page.route('https://unpkg.com/**', route => route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync('tests/functional/fake-peer.js', 'utf8') }));
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/index.html');
  await page.waitForFunction(() => !!window.ShitHeadMultiplayer);
  await page.locator('#soloPlay').click();
  await page.locator('#soloName').fill('Taylor');
  await page.locator('#soloNew').click();
  await expect(page.locator('#playerSeat .notepad-name')).toHaveText('Taylor');
  await expect(page.locator('.seat-opponent:not([hidden])')).toHaveCount(3);
  const overlap = (a, b) => Math.min(a.right, b.right) > Math.max(a.left, b.left) + 1 && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) + 1;
  async function checkGeometry() {
    const boxes = await page.evaluate(() => {
      const box = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
      return { hand: box('#playerSeat .hand'), actions: box('#playerSeat .play-actions'), ownTable: box('.self-table-zone'), drink: box('.self-beer-mat'), center: box('.centre-zone'), opponents: ['#opponentLeft', '#opponentTop', '#opponentRight'].map(box), width: document.documentElement.scrollWidth, viewport: innerWidth };
    });
    expect(boxes.width).toBeLessThanOrEqual(boxes.viewport);
    expect(overlap(boxes.hand, boxes.actions)).toBe(false);
    expect(overlap(boxes.ownTable, boxes.drink)).toBe(false);
    expect(overlap(boxes.ownTable, boxes.center)).toBe(false);
    expect(overlap(boxes.opponents[0], boxes.opponents[1])).toBe(false);
    expect(overlap(boxes.opponents[1], boxes.opponents[2])).toBe(false);
    for (const opponent of boxes.opponents) expect(overlap(opponent, boxes.center)).toBe(false);
  }
  for (const width of [320, 390, 430, 700]) { await page.setViewportSize({ width, height: 900 }); await checkGeometry(); }
  await page.setViewportSize({ width: 390, height: 844 });
  const before = await page.evaluate(() => ({ hand: cardText(state.players[state.viewer].hand[0]), table: cardText(state.players[state.viewer].faceUp[0]) }));
  await page.locator('.hand button.card').first().click();
  await page.locator('.self-face-row .setup-table-card').first().click();
  expect(await page.evaluate(() => cardText(state.players[state.viewer].hand[0]))).toBe(before.table);
  expect(await page.evaluate(() => cardText(state.players[state.viewer].faceUp[0]))).toBe(before.hand);
  await page.locator('.setup-ready').click();
  await page.evaluate(() => { state.currentPlayer = state.viewer; state.discard = []; state.followUpRank = null; render(); });
  await checkGeometry();
  await page.locator('.hand button.card').first().click();
  await expect(page.locator('.play-selected')).toBeEnabled();
  await page.locator('.play-selected').click();
  await page.locator('#tableMenuButton').click();
  const expectedBuild = fs.readFileSync('build-version.js', 'utf8').match(/window\.SHITHEAD_BUILD = "([^"]+)"/)[1];
  await expect(page.locator('#buildBadge')).toHaveText(`Build ${expectedBuild}`);
  await expect(page.locator('#themeSelect')).toBeVisible();
  await page.locator('#closeTableMenu').click();
  // A pickup can produce a very large hand: keep every card reachable by scrolling.
  await page.evaluate(() => { state.players[state.viewer].hand.push(...state.drawPile.splice(0)); state.currentPlayer = state.viewer; render(); });
  await checkGeometry();
  await page.locator('.hand button.card').last().click();
  await expect(page.locator('.hand button.card').last()).toHaveClass(/selected/);
  expect(errors).toEqual([]);
});
