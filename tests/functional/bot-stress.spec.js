const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const fakePeerSource = fs.readFileSync(path.join(__dirname, 'fake-peer.js'), 'utf8');
const PLAYER_NAMES = ['Oliver', 'Dan', 'Chris'];
const HOUSE_ORDER = ['4', '5', '6', '7', '8', '9', 'J', 'Q', 'K', 'A', '2', '3', '10'];
const SEEDS = [11, 29, 47];
const MAX_ACTIONS = 700;

function log(seed, message) {
  console.log(`[bot seed ${seed}] ${message}`);
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
    lastMessage: state.lastMessage,
    players: Object.fromEntries(PLAYER_NAMES.map((name) => [name, {
      hand: state.players[name].hand.map((card) => `${card.rank}${card.suit}`),
      tableSlots: (state.players[name].tableSlots || []).map((slot) => ({
        faceUp: slot?.faceUp ? `${slot.faceUp.rank}${slot.faceUp.suit}` : null,
        faceDown: slot?.faceDown ? `${slot.faceDown.rank}${slot.faceDown.suit}` : null,
      })),
    }])),
  }));
}

async function stateDigest(page) {
  return page.evaluate(() => JSON.stringify({
    phase: state.phase,
    currentPlayer: state.currentPlayer,
    drawCount: state.drawPile.length,
    discard: state.discard.map((card) => `${card.rank}${card.suit}`),
    burnCount: state.burnPile.length,
    followUpRank: state.followUpRank,
    finishOrder: state.finishOrder,
    shitHead: state.shitHead,
    hands: Object.fromEntries(PLAYER_NAMES.map((name) => [name, state.players[name].hand.map((card) => `${card.rank}${card.suit}`)])),
    tables: Object.fromEntries(PLAYER_NAMES.map((name) => [name, (state.players[name].tableSlots || []).map((slot) => [
      slot?.faceUp ? `${slot.faceUp.rank}${slot.faceUp.suit}` : null,
      slot?.faceDown ? `${slot.faceDown.rank}${slot.faceDown.suit}` : null,
    ])])),
  }));
}

async function expectAllSynced(pages, seed, actionNo) {
  await expect.poll(async () => {
    const signatures = await Promise.all(pages.map(canonicalSignature));
    return new Set(signatures).size;
  }, { message: `seed ${seed}, action ${actionNo}: browsers diverged` }).toBe(1);
}

async function assertCardConservation(host, seed, actionNo) {
  const result = await host.evaluate(() => {
    const ids = [];
    const add = (card) => { if (card) ids.push(`${card.rank}${card.suit}`); };
    state.drawPile.forEach(add);
    state.discard.forEach(add);
    state.burnPile.forEach(add);
    PLAYER_NAMES.forEach((name) => {
      state.players[name].hand.forEach(add);
      (state.players[name].tableSlots || []).forEach((slot) => {
        add(slot?.faceUp);
        add(slot?.faceDown);
      });
    });
    return {
      count: ids.length,
      unique: new Set(ids).size,
      ids,
      currentPlayer: state.currentPlayer,
      phase: state.phase,
      currentOut: state.phase === 'play' ? window.ShitHeadTablePlay?.isOut?.(state.currentPlayer) : false,
    };
  });

  expect(result.count, `seed ${seed}, action ${actionNo}: card count`).toBe(52);
  expect(result.unique, `seed ${seed}, action ${actionNo}: unique cards`).toBe(52);
  if (result.phase === 'play') {
    expect(result.currentOut, `seed ${seed}, action ${actionNo}: current player cannot be OUT`).toBe(false);
  }
}

async function installSeededRandom(host, seed) {
  await host.evaluate((value) => {
    let t = value >>> 0;
    window.__botOriginalRandom = Math.random;
    Math.random = function seededRandom() {
      t += 0x6D2B79F5;
      let r = t;
      r = Math.imul(r ^ (r >>> 15), r | 1);
      r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }, seed);
}

async function restoreRandom(host) {
  await host.evaluate(() => {
    if (window.__botOriginalRandom) Math.random = window.__botOriginalRandom;
    delete window.__botOriginalRandom;
  });
}

async function openSeededGame(browser, seed) {
  const context = await browser.newContext();
  await context.route('https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: fakePeerSource });
  });

  const oliver = await context.newPage();
  const dan = await context.newPage();
  const chris = await context.newPage();
  const pages = [oliver, dan, chris];
  const byName = { Oliver: oliver, Dan: dan, Chris: chris };

  await Promise.all(pages.map(waitForMultiplayer));
  const roomCode = await createRoom(oliver, 'Oliver');
  await joinRoom(dan, 'Dan', roomCode);
  await joinRoom(chris, 'Chris', roomCode);
  await expect(oliver.locator('#mpPlayers .room-player.connected')).toHaveCount(3);

  await installSeededRandom(oliver, seed);
  const lobbyStart = oliver.locator('.room-lobby-primary');
  await expect(lobbyStart).toBeVisible();
  await expect(lobbyStart).toBeEnabled();
  await lobbyStart.click();
  await Promise.all(pages.map((page) => page.waitForFunction(() => state.phase === 'setup')));
  await restoreRandom(oliver);
  await expectAllSynced(pages, seed, 0);

  // Bots make no table swaps yet; they do use the real SORT and READY controls.
  for (const name of PLAYER_NAMES) {
    await byName[name].locator('.sort-hand').click();
  }
  await expectAllSynced(pages, seed, 0);

  for (const name of PLAYER_NAMES) {
    await byName[name].locator('.setup-ready').click();
    if (name !== 'Chris') {
      await expect.poll(() => oliver.evaluate((n) => !!state.setupReady?.[n], name)).toBe(true);
    }
  }

  await Promise.all(pages.map((page) => page.waitForFunction(() => state.phase === 'play')));
  await expectAllSynced(pages, seed, 0);
  await assertCardConservation(oliver, seed, 0);

  return { context, pages, byName, host: oliver };
}

async function chooseAction(page, player) {
  return page.evaluate((name) => {
    const api = window.ShitHeadTablePlay;
    const player = state.players[name];
    const slots = api.getSlots(name);
    const order = ['4', '5', '6', '7', '8', '9', 'J', 'Q', 'K', 'A', '2', '3', '10'];

    function groupedRefs(zone, cards) {
      const groups = new Map();
      cards.forEach(({ card, index }) => {
        if (!card) return;
        if (!groups.has(card.rank)) groups.set(card.rank, []);
        groups.get(card.rank).push({ zone, index });
      });
      return [...groups.entries()].map(([rank, refs]) => ({ rank, refs }));
    }

    function rankPriority(rank) {
      // Clear/reset cards first, otherwise dump larger groups, then house-low rank.
      if (rank === '10') return -30;
      if (rank === '2') return -20;
      if (rank === '3') return -10;
      return order.indexOf(rank);
    }

    function chooseValid(groups) {
      return groups
        .filter((group) => api.validateRefs(name, group.refs).ok)
        .sort((a, b) => {
          if (b.refs.length !== a.refs.length) return b.refs.length - a.refs.length;
          return rankPriority(a.rank) - rankPriority(b.rank);
        })[0] || null;
    }

    if (state.followUpRank) {
      const rank = state.followUpRank;
      const handRefs = player.hand
        .map((card, index) => ({ card, index }))
        .filter(({ card }) => card.rank === rank)
        .map(({ index }) => ({ zone: 'hand', index }));
      if (handRefs.length && api.validateRefs(name, handRefs).ok) return { type: 'play', refs: handRefs };

      const faceRefs = slots
        .map((slot, index) => ({ card: slot.faceUp, index }))
        .filter(({ card }) => card?.rank === rank)
        .map(({ index }) => ({ zone: 'faceUp', index }));
      if (faceRefs.length && api.validateRefs(name, faceRefs).ok) return { type: 'play', refs: faceRefs };
      return { type: 'finish' };
    }

    if (player.hand.length > 0 || state.drawPile.length > 0) {
      const groups = groupedRefs('hand', player.hand.map((card, index) => ({ card, index })));
      const chosen = chooseValid(groups);
      if (chosen) return { type: 'play', refs: chosen.refs };
    } else {
      const groups = groupedRefs('faceUp', slots.map((slot, index) => ({ card: slot.faceUp, index })));
      const chosen = chooseValid(groups);
      if (chosen) return { type: 'play', refs: chosen.refs };

      const blindIndex = slots.findIndex((_, index) => api.canBlind(name, index));
      if (blindIndex >= 0) return { type: 'blind', slotIndex: blindIndex };
    }

    if (state.discard.length > 0) return { type: 'pickup' };
    return { type: 'stuck', snapshot: {
      phase: state.phase,
      currentPlayer: state.currentPlayer,
      hand: player.hand.map((card) => `${card.rank}${card.suit}`),
      table: slots.map((slot) => ({ up: slot.faceUp?.rank || null, down: !!slot.faceDown })),
      draw: state.drawPile.length,
      discard: state.discard.length,
      followUpRank: state.followUpRank,
    } };
  }, player);
}

async function clickPlayRefs(page, refs) {
  for (const ref of refs) {
    if (ref.zone === 'hand') {
      await page.locator('.hand button.card').nth(ref.index).click();
    } else {
      await page.locator(`.self-face-row button.table-play-card[data-slot-index="${ref.index}"]`).click();
    }
  }
  const play = page.locator('.play-selected');
  await expect(play).toBeVisible();
  await expect(play).toBeEnabled();
  await play.click();
}

async function executeAction(page, action) {
  if (action.type === 'play') {
    await clickPlayRefs(page, action.refs);
    return;
  }
  if (action.type === 'blind') {
    const blind = page.locator(`.self-face-row button.table-blind-card[data-slot-index="${action.slotIndex}"]`);
    await expect(blind).toBeVisible();
    await blind.click();
    return;
  }
  if (action.type === 'pickup') {
    const pickup = page.locator('.pickup-pile');
    await expect(pickup).toBeVisible();
    await expect(pickup).toBeEnabled();
    await pickup.click();
    return;
  }
  if (action.type === 'finish') {
    const finish = page.locator('.finish-turn');
    await expect(finish).toBeVisible();
    await expect(finish).toBeEnabled();
    await finish.click();
    return;
  }
  throw new Error(`Bot has no legal action: ${JSON.stringify(action.snapshot || action)}`);
}

async function runGame(browser, seed) {
  const { context, pages, byName, host } = await openSeededGame(browser, seed);
  let actions = 0;
  const actionCounts = { play: 0, blind: 0, pickup: 0, finish: 0 };

  try {
    while (actions < MAX_ACTIONS) {
      const phase = await host.evaluate(() => state.phase);
      if (phase === 'gameover') break;
      expect(phase, `seed ${seed}, action ${actions}: expected play/gameover`).toBe('play');

      const player = await host.evaluate(() => state.currentPlayer);
      expect(PLAYER_NAMES).toContain(player);
      const actor = byName[player];
      const before = await stateDigest(host);
      const action = await chooseAction(actor, player);
      if (actionCounts[action.type] !== undefined) actionCounts[action.type] += 1;

      await executeAction(actor, action);
      actions += 1;

      await host.waitForFunction((previous) => JSON.stringify({
        phase: state.phase,
        currentPlayer: state.currentPlayer,
        drawCount: state.drawPile.length,
        discard: state.discard.map((card) => `${card.rank}${card.suit}`),
        burnCount: state.burnPile.length,
        followUpRank: state.followUpRank,
        finishOrder: state.finishOrder,
        shitHead: state.shitHead,
        hands: Object.fromEntries(PLAYER_NAMES.map((name) => [name, state.players[name].hand.map((card) => `${card.rank}${card.suit}`)])),
        tables: Object.fromEntries(PLAYER_NAMES.map((name) => [name, (state.players[name].tableSlots || []).map((slot) => [
          slot?.faceUp ? `${slot.faceUp.rank}${slot.faceUp.suit}` : null,
          slot?.faceDown ? `${slot.faceDown.rank}${slot.faceDown.suit}` : null,
        ])])),
      }) !== previous, before);

      await expectAllSynced(pages, seed, actions);
      await assertCardConservation(host, seed, actions);
    }

    const end = await host.evaluate(() => ({
      phase: state.phase,
      shitHead: state.shitHead,
      finishOrder: [...state.finishOrder],
      scores: { ...state.scores },
      roundScored: state.roundScored,
      message: state.lastMessage,
    }));

    expect(end.phase, `seed ${seed}: exceeded ${MAX_ACTIONS} actions`).toBe('gameover');
    expect(PLAYER_NAMES).toContain(end.shitHead);
    expect(end.roundScored).toBe(true);
    expect(Object.values(end.scores).reduce((sum, value) => sum + Number(value || 0), 0)).toBe(1);
    expect(end.scores[end.shitHead]).toBe(1);
    await expectAllSynced(pages, seed, actions);
    await assertCardConservation(host, seed, actions);

    log(seed, `PASS in ${actions} actions; Shit Head=${end.shitHead}; actions=${JSON.stringify(actionCounts)}`);
  } catch (error) {
    const snapshot = await host.evaluate(() => ({
      phase: state.phase,
      currentPlayer: state.currentPlayer,
      draw: state.drawPile.length,
      discard: state.discard.map((card) => `${card.rank}${card.suit}`),
      burn: state.burnPile.length,
      followUpRank: state.followUpRank,
      finishOrder: state.finishOrder,
      shitHead: state.shitHead,
      hands: Object.fromEntries(PLAYER_NAMES.map((name) => [name, state.players[name].hand.map((card) => `${card.rank}${card.suit}`)])),
      tables: Object.fromEntries(PLAYER_NAMES.map((name) => [name, (state.players[name].tableSlots || []).map((slot) => ({
        up: slot?.faceUp ? `${slot.faceUp.rank}${slot.faceUp.suit}` : null,
        down: slot?.faceDown ? `${slot.faceDown.rank}${slot.faceDown.suit}` : null,
      }))])),
      message: state.lastMessage,
    }));
    console.error(`[bot seed ${seed}] FAILED after ${actions} actions: ${JSON.stringify(snapshot)}`);
    throw error;
  } finally {
    await context.close();
  }
}

for (const seed of SEEDS) {
  test(`seeded bots complete synchronized game ${seed}`, async ({ browser }) => {
    test.setTimeout(120000);
    await runGame(browser, seed);
  });
}
