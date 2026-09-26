const {test, expect} = require('@playwright/test');
const fs = require('node:fs');
test.beforeEach(async ({page}) => {
  await page.route('https://unpkg.com/**', route => route.fulfill({contentType:'application/javascript', body:fs.readFileSync('tests/functional/fake-peer.js','utf8')}));
  await page.goto('/index.html');
  await page.waitForFunction(() => !!window.ShitHeadMultiplayer && !!window.ShitHeadTableSocial);
});

async function position(page, current = 'Oliver') {
  await page.evaluate(current => {
    const c = (rank, suit = '♠') => ({rank,suit});
    PLAYER_NAMES.forEach(n => Object.assign(state.players[n], {
      hand: [c('4'),c('5')], faceUp:[], faceDown:[],
      tableSlots: [0,1,2].map(() => ({faceUp:null,faceDown:null})),
    }));
    Object.assign(state, {phase:'play',currentPlayer:current,discard:[],drawPile:[],burnPile:[],
      followUpRank:null, tableEvent:null, finishOrder:[], shitHead:null, roundScored:false, lastMessage:''});
    render();
  }, current);
}

test('turn names replace the revealing banner; Ofcom and large pickups show only public outcomes', async ({page}) => {
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width:390,height:844});
  await position(page);
  await page.evaluate(() => {
    state.followUpRank = 'J'; render(); render();
  });
  await expect(page.locator('.mobile-turn-status')).toBeHidden();
  await expect(page.locator('.seat-turn-tag')).toHaveCount(1);
  await expect(page.locator('#playerSeat .turn-highlight')).toHaveCount(1);
  await expect(page.locator('.seat-turn-tag')).toHaveText('YOUR TURN');
  await page.evaluate(() => { state.viewer='Dan'; render(); });
  await expect(page.locator('#playerSeat .turn-highlight')).toHaveCount(0);
  await expect(page.locator('.seat-turn-tag')).toHaveText('TURN');
  await expect(page.locator('.mobile-turn-status')).toBeHidden();
  await page.evaluate(() => {
    state.viewer='Oliver'; state.followUpRank=null;
    state.players.Oliver.hand = ['♠','♥','♦'].map(suit=>({rank:'8',suit})).concat({rank:'5',suit:'♣'});
    window.ShitHeadTablePlay.playRefs('Oliver',[0,1,2].map(index=>({zone:'hand',index})));
  });
  await expect(page.locator('#playerSeat .seat-callout')).toHaveText('Ofcom! 📺');
  expect(await page.evaluate(() => [state.discard.length,state.burnPile.length,state.currentPlayer])).toEqual([0,3,'Oliver']);
  await page.screenshot({path:'artifacts/seat-ofcom-0945.png',fullPage:true});
  await page.evaluate(() => {
    state.discard = ['4','5','6','7','8','9','J','Q','K','A'].map(rank=>({rank,suit:'♦'}));
    pickupDiscard('Oliver');
  });
  await expect(page.locator('#playerSeat .seat-callout')).toHaveText('Monster pickup! 10 cards');
  expect(await page.evaluate(() => Object.keys(state.tableEvent).sort())).toEqual(['at','count','id','kind','player']);
  await page.evaluate(() => render());
  await expect(page.locator('#playerSeat .seat-callout')).toHaveText('Monster pickup! 10 cards');
  await expect(page.locator('.seat-callout')).toHaveCount(0,{timeout:4000});
  await page.evaluate(() => render());
  await expect(page.locator('.seat-callout')).toHaveCount(0);
  await page.evaluate(() => {
    state.phase='gameover'; state.shitHead=state.viewer; state.displayNames[state.viewer]='You'; render();
  });
  await expect(page.locator('#roundOverResult')).toContainText('You are the Shit Head.');
  await expect(page.locator('.seat-turn-tag')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('normal CPU actions wait 1.5 seconds and a pickup leaves 2.2 seconds to read the table', async ({page}) => {
  await page.locator('#soloPlay').click(); await page.locator('#soloNew').click();
  const now = new Date();
  await page.clock.install({time: now});
  await page.clock.pauseAt(new Date(now.getTime() + 1000));
  await position(page,'Dan');
  await page.clock.runFor(1490);
  expect(await page.evaluate(() => state.tableEvent)).toBeNull();
  await page.clock.runFor(20);
  expect(await page.evaluate(() => state.tableEvent?.player)).toBe('Dan');
  await page.evaluate(() => {
    state.currentPlayer=state.viewer; state.followUpRank=null;
    state.discard=[{rank:'A',suit:'♥'}]; pickupDiscard(state.viewer);
  });
  const id=await page.evaluate(() => state.tableEvent.id);
  await page.clock.runFor(2190);
  expect(await page.evaluate(() => state.tableEvent.id)).toBe(id);
  await page.clock.runFor(20);
  expect(await page.evaluate(() => state.tableEvent.id)).not.toBe(id);
});
