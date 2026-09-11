const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const fakePeer = fs.readFileSync(path.join(__dirname, 'fake-peer.js'), 'utf8');
test('solo human can select and play face-up cards, reject illegal cards, and combine final hand/table cards', async ({page}) => {
  await page.route('https://unpkg.com/**', r => r.fulfill({contentType:'application/javascript', body:fakePeer}));
  await page.goto('/index.html');
  await page.waitForFunction(() => !!window.ShitHeadMultiplayer);
  await page.locator('#soloPlay').click();
  await page.locator('#soloNew').click();
  await page.evaluate(() => {
    const c = (rank,suit='♠') => ({rank,suit});
    state.phase='play'; state.currentPlayer=state.viewer; state.drawPile=[];
    state.discard=[c('6','♣'),c('6','♦'),c('6')]; state.followUpRank=null;
    const p=state.players[state.viewer]; p.hand=[];
    p.tableSlots=[{faceUp:c('9'),faceDown:c('4')},{faceUp:c('8'),faceDown:c('5')},{faceUp:c('9','♥'),faceDown:c('J')}];
    state.selected=[]; state.selectedRefs=[]; render();
  });
  const table = page.locator('#playerSeat .table-play-card[data-slot-index="1"]');
  await table.click();
  await expect(table).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#playerSeat .play-selected')).toBeEnabled();
  await page.locator('#playerSeat .play-selected').click();
  expect(await page.evaluate(() => state.discard.at(-1).rank)).toBe('8');
  expect(await page.evaluate(() => state.players[state.viewer].tableSlots[1].faceUp)).toBeNull();
  await page.evaluate(() => {
    state.currentPlayer=state.viewer; state.followUpRank=null; state.discard=[{rank:'A',suit:'♦'}]; render();
  });
  await page.locator('#playerSeat .table-play-card[data-slot-index="0"]').click();
  await expect(page.locator('#playerSeat .play-selected')).not.toBeEnabled();
  await expect(page.locator('#playerSeat .pickup-pile')).toContainText('PICK UP 1 + PILE');
  await page.evaluate(() => {
    state.currentPlayer=state.viewer; state.discard=[{rank:'6',suit:'♠'}]; state.followUpRank=null;
    state.players[state.viewer].hand=[{rank:'9',suit:'♦'}]; state.selected=[]; state.selectedRefs=[]; render();
  });
  await page.locator('#playerSeat .hand button.card').click();
  await page.locator('#playerSeat .table-play-card[data-slot-index="0"]').click();
  await expect(page.locator('#playerSeat .play-selected')).toHaveText('PLAY 2');
  await page.locator('#playerSeat .play-selected').click();
  expect(await page.evaluate(() => state.players[state.viewer].hand.length)).toBe(0);
  expect(await page.evaluate(() => state.players[state.viewer].tableSlots[0].faceUp)).toBeNull();
});
