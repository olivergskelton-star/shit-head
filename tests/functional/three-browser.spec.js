const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const fakePeerSource = fs.readFileSync(path.join(__dirname, 'fake-peer.js'), 'utf8');
const HOUSE_ORDER = ['4', '5', '6', '7', '8', '9', 'J', 'Q', 'K', 'A', '2', '3', '10'];

function step(message) {
  console.log(`[three-browser] ${message}`);
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

async function handSignature(page, player) {
  return page.evaluate((name) => state.players[name].hand.map((card) => `${card.rank}${card.suit}`), player);
}

async function canonicalSignature(page) {
  return page.evaluate(() => JSON.stringify({
    phase: state.phase,
    currentPlayer: state.currentPlayer,
    startingPlayer: state.startingPlayer,
    drawCount: state.drawPile.length,
    discard: state.discard.map((card) => `${card.rank}${card.suit}`),
    burn: state.burnPile.map((card) => `${card.rank}${card.suit}`),
    setupReady: state.setupReady,
    setupReadyOrder: state.setupReadyOrder,
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

async function forceCleanTurn(host, pages, player) {
  await host.evaluate((name) => {
    state.phase = 'play';
    state.currentPlayer = name;
    state.followUpRank = null;
    state.discard = [];
    state.selected = [];
    if (Array.isArray(state.selectedRefs)) state.selectedRefs = [];
    render();
    window.ShitHeadMultiplayer.publishState();
  }, player);
  await Promise.all(pages.map((page) => page.waitForFunction((name) => (
    state.phase === 'play' && state.currentPlayer === name
  ), player)));
}

async function playFirstHandCard(actor, host, player) {
  const before = await host.evaluate((name) => state.players[name].hand.length, player);
  expect(before).toBeGreaterThan(0);

  const firstCard = actor.locator('.hand button.card').first();
  await expect(firstCard).toBeVisible();
  await firstCard.click();
  const playButton = actor.locator('.play-selected');
  await expect(playButton).toBeVisible();
  await expect(playButton).toBeEnabled();
  await playButton.click();

  await host.waitForFunction(({ name, count }) => state.players[name].hand.length < count, { name: player, count: before });
}

test('three real pages stay in sync through SORT, READY, PLAY and PICK UP', async ({ browser }) => {
  const context = await browser.newContext();
  await context.route('https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: fakePeerSource });
  });

  const oliver = await context.newPage();
  const dan = await context.newPage();
  const chris = await context.newPage();
  const pages = [oliver, dan, chris];
  const byName = { Oliver: oliver, Dan: dan, Chris: chris };

  step('load three real game pages');
  await Promise.all(pages.map(waitForMultiplayer));

  step('create and join one virtual room');
  const roomCode = await createRoom(oliver, 'Oliver');
  await joinRoom(dan, 'Dan', roomCode);
  await joinRoom(chris, 'Chris', roomCode);
  await expect(oliver.locator('#mpPlayers .room-player.connected')).toHaveCount(3);

  step('start game from the real in-dialog lobby button and verify setup is synchronized');
  const lobbyStart = oliver.locator('.room-lobby-primary');
  await expect(lobbyStart).toBeVisible();
  await expect(lobbyStart).toBeEnabled();
  await expect(lobbyStart).toHaveText('START GAME');
  await lobbyStart.click();
  await Promise.all(pages.map((page) => page.waitForFunction(() => state.phase === 'setup')));
  await expectAllSynced(pages);

  step('sort all three hands during setup');
  for (const [name, page] of Object.entries(byName)) {
    await page.locator('.sort-hand').click();
    const locallySorted = await handSignature(page, name);
    const rankNumbers = locallySorted.map((value) => HOUSE_ORDER.indexOf(value.replace(/[♠♥♦♣]$/, '')));
    expect([...rankNumbers].sort((a, b) => a - b)).toEqual(rankNumbers);
    await expect.poll(() => handSignature(oliver, name)).toEqual(locallySorted);
  }
  await expectAllSynced(pages);

  step('ready all three with third READY from client Chris');
  await oliver.locator('.setup-ready').click();
  await expect.poll(() => oliver.evaluate(() => state.setupReady.Oliver)).toBe(true);
  await dan.locator('.setup-ready').click();
  await expect.poll(() => oliver.evaluate(() => state.setupReady.Dan)).toBe(true);
  await chris.locator('.setup-ready').click();
  await Promise.all(pages.map((page) => page.waitForFunction(() => state.phase === 'play')));
  await expectAllSynced(pages);

  const starters = await Promise.all(pages.map((page) => page.evaluate(() => state.currentPlayer)));
  expect(new Set(starters).size).toBe(1);
  expect(['Oliver', 'Dan', 'Chris']).toContain(starters[0]);

  step('sort Dan during Oliver turn');
  await forceCleanTurn(oliver, pages, 'Oliver');
  await dan.locator('.sort-hand').click();
  const danSorted = await handSignature(dan, 'Dan');
  await expect.poll(() => handSignature(oliver, 'Dan')).toEqual(danSorted);
  await expectAllSynced(pages);

  step('client Dan selects a real card and clicks real PLAY');
  await forceCleanTurn(oliver, pages, 'Dan');
  await playFirstHandCard(dan, oliver, 'Dan');
  await expectAllSynced(pages);

  step('host Oliver selects a real card and clicks real PLAY');
  await forceCleanTurn(oliver, pages, 'Oliver');
  await playFirstHandCard(oliver, oliver, 'Oliver');
  await expectAllSynced(pages);

  step('client Chris clicks real PICK UP');
  await oliver.evaluate(() => {
    state.phase = 'play';
    state.currentPlayer = 'Chris';
    state.followUpRank = null;
    state.discard = [
      { rank: '4', suit: '♠' },
      { rank: '5', suit: '♥' },
      { rank: '6', suit: '♦' },
      { rank: '9', suit: '♣' },
      { rank: 'Q', suit: '♠' },
    ];
    render();
    window.ShitHeadMultiplayer.publishState();
  });
  await Promise.all(pages.map((page) => page.waitForFunction(() => state.currentPlayer === 'Chris' && state.discard.length === 5)));
  const chrisBefore = await oliver.evaluate(() => state.players.Chris.hand.length);
  const pickup = chris.locator('.pickup-pile');
  await expect(pickup).toBeVisible();
  await expect(pickup).toBeEnabled();
  await pickup.click();
  await oliver.waitForFunction((before) => state.discard.length === 0 && state.players.Chris.hand.length === before + 5, chrisBefore);
  await expectAllSynced(pages);

  step('PASS: SORT, READY, client PLAY, host PLAY and PICK UP all synchronized');
  await context.close();
});
