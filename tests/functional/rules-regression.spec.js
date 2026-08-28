const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const fakePeerSource = fs.readFileSync(path.join(__dirname, 'fake-peer.js'), 'utf8');

function c(rank, suit = '♠') { return { rank, suit }; }
function emptySlots() {
  return [0, 1, 2].map(() => ({ faceUp: null, faceDown: null }));
}
function coveredSlots(faceUps = ['A', 'K', 'Q'], faceDowns = ['4', '5', '6']) {
  return [0, 1, 2].map((index) => ({
    faceUp: faceUps[index] ? c(faceUps[index], ['♠', '♥', '♦'][index]) : null,
    faceDown: faceDowns[index] ? c(faceDowns[index], ['♣', '♦', '♥'][index]) : null,
  }));
}
function p(hand = [c('4')], tableSlots = coveredSlots()) {
  return {
    hand,
    tableSlots,
    faceUp: tableSlots.map((slot) => slot.faceUp).filter(Boolean),
    faceDown: tableSlots.map((slot) => slot.faceDown).filter(Boolean),
  };
}

function step(message) {
  console.log(`[rules-regression] ${message}`);
}

async function waitForMultiplayer(page) {
  await page.goto('/index.html');
  await page.waitForFunction(() => !!window.ShitHeadMultiplayer && !!document.querySelector('.multiplayer-trigger'));
}

async function createRoom(page, player) {
  await page.locator('.multiplayer-trigger').click();
  await page.locator('#mpPlayer').selectOption(player);
  await page.locator('#mpCreate').click();
  await expect(page.locator('#mpRoomDisplay')).not.toHaveText('');
  return (await page.locator('#mpRoomDisplay').textContent()).trim();
}

async function joinRoom(page, player, roomCode) {
  await page.locator('.multiplayer-trigger').click();
  await page.locator('#mpPlayer').selectOption(player);
  await page.locator('#mpRoomCode').fill(roomCode);
  await page.locator('#mpJoin').click();
  await page.waitForFunction((name) => (
    window.ShitHeadMultiplayer?.status?.role === 'client'
    && window.ShitHeadMultiplayer?.status?.player === name
  ), player);
}

async function canonicalSignature(page) {
  return page.evaluate(() => JSON.stringify({
    phase: state.phase,
    currentPlayer: state.currentPlayer,
    startingPlayer: state.startingPlayer,
    drawPile: state.drawPile.map((card) => `${card.rank}${card.suit}`),
    discard: state.discard.map((card) => `${card.rank}${card.suit}`),
    burnPile: state.burnPile.map((card) => `${card.rank}${card.suit}`),
    followUpRank: state.followUpRank,
    finishOrder: state.finishOrder,
    shitHead: state.shitHead,
    scores: state.scores,
    roundScored: state.roundScored,
    players: Object.fromEntries(PLAYER_NAMES.map((name) => [name, {
      hand: state.players[name].hand.map((card) => `${card.rank}${card.suit}`),
      tableSlots: (state.players[name].tableSlots || []).map((slot) => ({
        faceUp: slot?.faceUp ? `${slot.faceUp.rank}${slot.faceUp.suit}` : null,
        faceDown: slot?.faceDown ? `${slot.faceDown.rank}${slot.faceDown.suit}` : null,
      })),
    }])),
  }));
}

async function expectAllSynced(pages) {
  await expect.poll(async () => {
    const signatures = await Promise.all(pages.map(canonicalSignature));
    return new Set(signatures).size;
  }).toBe(1);
}

async function openStartedRoom(browser) {
  const context = await browser.newContext();
  await context.route('https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: fakePeerSource });
  });

  const oliver = await context.newPage();
  const dan = await context.newPage();
  const chris = await context.newPage();
  const pages = [oliver, dan, chris];

  await Promise.all(pages.map(waitForMultiplayer));
  const roomCode = await createRoom(oliver, 'Oliver');
  await joinRoom(dan, 'Dan', roomCode);
  await joinRoom(chris, 'Chris', roomCode);
  await expect(oliver.locator('#mpPlayers .room-player.connected')).toHaveCount(3);

  const lobbyStart = oliver.locator('.room-lobby-primary');
  await expect(lobbyStart).toBeVisible();
  await expect(lobbyStart).toBeEnabled();
  await lobbyStart.click();
  await Promise.all(pages.map((page) => page.waitForFunction(() => state.phase === 'setup')));
  await expectAllSynced(pages);

  return { context, pages, oliver, dan, chris };
}

async function forceScenario(host, pages, spec) {
  await host.evaluate((scenario) => {
    state.phase = 'play';
    state.currentPlayer = scenario.currentPlayer;
    state.startingPlayer = scenario.currentPlayer;
    state.drawPile = scenario.drawPile || [];
    state.discard = scenario.discard || [];
    state.burnPile = scenario.burnPile || [];
    state.followUpRank = null;
    state.finishOrder = scenario.finishOrder || [];
    state.shitHead = null;
    state.roundScored = false;
    state.scores = scenario.scores || { Oliver: 0, Dan: 0, Chris: 0 };
    state.selected = [];
    if (Array.isArray(state.selectedRefs)) state.selectedRefs = [];
    state.players = scenario.players;
    state.lastMessage = scenario.marker;
    render();
    window.ShitHeadMultiplayer.publishState();
  }, spec);

  await Promise.all(pages.map((page) => page.waitForFunction((marker) => state.lastMessage === marker, spec.marker)));
  await expectAllSynced(pages);
}

async function playSelected(page) {
  const play = page.locator('.play-selected');
  await expect(play).toBeVisible();
  await expect(play).toBeEnabled();
  await play.click();
}

async function clickHandIndices(page, indices) {
  for (const index of indices) {
    await page.locator('.hand button.card').nth(index).click();
  }
}

test('table stacks, blind play, burns, privacy, gameover and score stay synchronized', async ({ browser }) => {
  const { context, pages, oliver, dan } = await openStartedRoom(browser);

  step('face-up play removes only that slot top and preserves its face-down card');
  await forceScenario(oliver, pages, {
    marker: 'TEST independent slot',
    currentPlayer: 'Oliver',
    players: {
      Oliver: p([], [
        { faceUp: c('6'), faceDown: c('4', '♣') },
        { faceUp: c('5'), faceDown: c('7', '♦') },
        { faceUp: c('9'), faceDown: c('K', '♥') },
      ]),
      Dan: p([c('4')]),
      Chris: p([c('5')]),
    },
  });
  await oliver.locator('.self-face-row button.table-play-card[data-slot-index="0"]').click();
  await playSelected(oliver);
  await oliver.waitForFunction(() => state.players.Oliver.tableSlots[0].faceUp === null);
  expect(await oliver.evaluate(() => state.players.Oliver.tableSlots[0].faceDown.rank)).toBe('4');
  expect(await oliver.evaluate(() => state.players.Oliver.tableSlots[1].faceUp.rank)).toBe('5');
  await expectAllSynced(pages);

  step('one exposed blind is playable even while other face-up cards remain');
  await forceScenario(oliver, pages, {
    marker: 'TEST exposed blind',
    currentPlayer: 'Oliver',
    players: {
      Oliver: p([], [
        { faceUp: null, faceDown: c('4', '♣') },
        { faceUp: c('5'), faceDown: c('7', '♦') },
        { faceUp: c('9'), faceDown: c('K', '♥') },
      ]),
      Dan: p([c('4')]),
      Chris: p([c('5')]),
    },
  });
  const blind = oliver.locator('.self-face-row button.table-blind-card[data-slot-index="0"]');
  await expect(blind).toBeVisible();
  await blind.click();
  await oliver.waitForFunction(() => state.players.Oliver.tableSlots[0].faceDown === null);
  expect(await oliver.evaluate(() => state.players.Oliver.tableSlots[1].faceUp.rank)).toBe('5');
  expect(await oliver.evaluate(() => state.discard.at(-1).rank)).toBe('4');
  await expectAllSynced(pages);

  step('final K,K hand can include matching visible table K in the same play');
  await forceScenario(oliver, pages, {
    marker: 'TEST mixed final hand and table',
    currentPlayer: 'Oliver',
    players: {
      Oliver: p([c('K', '♠'), c('K', '♥')], [
        { faceUp: c('8'), faceDown: c('4') },
        { faceUp: c('9'), faceDown: c('5') },
        { faceUp: c('K', '♦'), faceDown: c('6') },
      ]),
      Dan: p([c('4')]),
      Chris: p([c('5')]),
    },
  });
  await clickHandIndices(oliver, [0, 1]);
  await oliver.locator('.self-face-row button.table-play-card[data-slot-index="2"]').click();
  await playSelected(oliver);
  await oliver.waitForFunction(() => state.players.Oliver.hand.length === 0 && state.players.Oliver.tableSlots[2].faceUp === null);
  expect(await oliver.evaluate(() => state.discard.map((card) => card.rank))).toEqual(['K', 'K', 'K']);
  await expectAllSynced(pages);

  step('three 8s burn and keep the turn');
  await forceScenario(oliver, pages, {
    marker: 'TEST three eights burn',
    currentPlayer: 'Dan',
    discard: [c('8', '♣'), c('8', '♦')],
    players: {
      Oliver: p([c('4')]),
      Dan: p([c('8', '♥')]),
      Chris: p([c('5')]),
    },
  });
  await dan.locator('.hand button.card').first().click();
  await playSelected(dan);
  await oliver.waitForFunction(() => state.discard.length === 0 && state.burnPile.length === 3);
  expect(await oliver.evaluate(() => state.currentPlayer)).toBe('Dan');
  await expectAllSynced(pages);

  step('four of a kind burns and keeps the turn');
  await forceScenario(oliver, pages, {
    marker: 'TEST four kind burn',
    currentPlayer: 'Dan',
    discard: [c('Q', '♣'), c('Q', '♦'), c('Q', '♥')],
    players: {
      Oliver: p([c('4')]),
      Dan: p([c('Q', '♠')]),
      Chris: p([c('5')]),
    },
  });
  await dan.locator('.hand button.card').first().click();
  await playSelected(dan);
  await oliver.waitForFunction(() => state.discard.length === 0 && state.burnPile.length === 4);
  expect(await oliver.evaluate(() => state.currentPlayer)).toBe('Dan');
  await expectAllSynced(pages);

  step('10 burns an existing pile and keeps the turn');
  await forceScenario(oliver, pages, {
    marker: 'TEST ten burn',
    currentPlayer: 'Dan',
    discard: [c('4', '♣'), c('5', '♦'), c('6', '♥')],
    players: {
      Oliver: p([c('4')]),
      Dan: p([c('10', '♠')]),
      Chris: p([c('5')]),
    },
  });
  await dan.locator('.hand button.card').first().click();
  await playSelected(dan);
  await oliver.waitForFunction(() => state.discard.length === 0 && state.burnPile.length === 4);
  expect(await oliver.evaluate(() => state.currentPlayer)).toBe('Dan');
  await expectAllSynced(pages);

  step('same-rank follow-up stays private in shared status text');
  await forceScenario(oliver, pages, {
    marker: 'TEST followup privacy',
    currentPlayer: 'Dan',
    players: {
      Oliver: p([c('4')]),
      Dan: p([c('5', '♠'), c('5', '♥')]),
      Chris: p([c('6')]),
    },
  });
  await dan.locator('.hand button.card').first().click();
  await playSelected(dan);
  await oliver.waitForFunction(() => state.followUpRank === '5' && state.players.Dan.hand.length === 1);
  const sharedMessages = await Promise.all(pages.map((page) => page.evaluate(() => state.lastMessage)));
  expect(new Set(sharedMessages).size).toBe(1);
  expect(sharedMessages[0]).not.toMatch(/another|available|matching card.*left/i);
  await expectAllSynced(pages);

  step('final-card burn marks Dan OUT, leaves Chris Shit Head, scores once, and draw visual is empty');
  await forceScenario(oliver, pages, {
    marker: 'TEST final card burn gameover',
    currentPlayer: 'Dan',
    discard: [c('5', '♣'), c('6', '♦')],
    finishOrder: ['Oliver'],
    scores: { Oliver: 0, Dan: 0, Chris: 0 },
    players: {
      Oliver: p([], emptySlots()),
      Dan: p([c('10', '♠')], emptySlots()),
      Chris: p([c('4', '♥')], emptySlots()),
    },
  });
  await dan.locator('.hand button.card').first().click();
  await playSelected(dan);
  await Promise.all(pages.map((page) => page.waitForFunction(() => state.phase === 'gameover' && state.shitHead === 'Chris')));
  await expectAllSynced(pages);

  const endState = await oliver.evaluate(() => ({
    score: state.scores.Chris,
    roundScored: state.roundScored,
    finishOrder: [...state.finishOrder],
    burnCount: state.burnPile.length,
  }));
  expect(endState.score).toBe(1);
  expect(endState.roundScored).toBe(true);
  expect(endState.finishOrder).toContain('Dan');
  expect(endState.burnCount).toBe(3);

  await oliver.evaluate(() => render());
  expect(await oliver.evaluate(() => state.scores.Chris)).toBe(1);
  await oliver.evaluate(() => window.ShitHeadMultiplayer.publishState());
  await expectAllSynced(pages);

  for (const page of pages) {
    await expect(page.locator('.pile-draw')).toHaveClass(/is-empty/);
    await expect(page.locator('.pile-draw .stacked')).toBeHidden();
  }

  step('PASS: table/endgame regression path is synchronized');
  await context.close();
});
