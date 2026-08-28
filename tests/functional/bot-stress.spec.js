const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const fakePeerSource = fs.readFileSync(path.join(__dirname, 'fake-peer.js'), 'utf8');
const PLAYER_NAMES = ['Oliver', 'Dan', 'Chris'];
const SEEDS = [11, 29, 47];
const MAX_ACTIONS = 1500;

function log(seed, message) {
  console.log(`[bot seed ${seed}] ${message}`);
}

async function waitForMultiplayer(page) {
  page.setDefaultTimeout(4000);
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

async function canonicalSignature(page) {
  const value = await page.evaluate(() => {
    const id = (card) => card ? `${card.rank}${card.suit}` : null;
    const players = Object.fromEntries(PLAYER_NAMES.map((name) => {
      const player = state.players[name];
      const slots = player.tableSlots || [0, 1, 2].map((index) => ({
        faceUp: player.faceUp?.[index] || null,
        faceDown: player.faceDown?.[index] || null,
      }));
      return [name, {
        hand: player.hand.map(id),
        tableSlots: slots.map((slot) => ({ faceUp: id(slot?.faceUp), faceDown: id(slot?.faceDown) })),
      }];
    }));
    return {
      phase: state.phase,
      currentPlayer: state.currentPlayer,
      startingPlayer: state.startingPlayer,
      drawPile: state.drawPile.map(id),
      discard: state.discard.map(id),
      burnPile: (state.burnPile || []).map(id),
      followUpRank: state.followUpRank || null,
      finishOrder: [...(state.finishOrder || [])],
      shitHead: state.shitHead || null,
      scores: { ...(state.scores || {}) },
      roundScored: !!state.roundScored,
      lastMessage: state.lastMessage,
      players,
    };
  });
  return JSON.stringify(value);
}

async function expectAllSynced(pages, seed, actionNo) {
  const expected = await canonicalSignature(pages[0]);
  await Promise.all(pages.slice(1).map((page, index) => expect.poll(
    () => canonicalSignature(page),
    {
      timeout: 2500,
      intervals: [10, 20, 40, 80],
      message: `seed ${seed}, action ${actionNo}: browser ${index + 2} diverged`,
    },
  ).toBe(expected)));
}

async function assertCardConservation(host, seed, actionNo) {
  const result = await host.evaluate(() => {
    const ids = [];
    const add = (card) => { if (card) ids.push(`${card.rank}${card.suit}`); };
    state.drawPile.forEach(add);
    state.discard.forEach(add);
    (state.burnPile || []).forEach(add);
    PLAYER_NAMES.forEach((name) => {
      const player = state.players[name];
      player.hand.forEach(add);
      const slots = player.tableSlots || [0, 1, 2].map((index) => ({
        faceUp: player.faceUp?.[index] || null,
        faceDown: player.faceDown?.[index] || null,
      }));
      slots.forEach((slot) => { add(slot?.faceUp); add(slot?.faceDown); });
    });
    const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
    return {
      count: ids.length,
      unique: new Set(ids).size,
      duplicates,
      phase: state.phase,
      currentPlayer: state.currentPlayer,
      currentOut: state.phase === 'play' ? !!window.ShitHeadTablePlay?.isOut?.(state.currentPlayer) : false,
    };
  });

  expect(result.count, `seed ${seed}, action ${actionNo}: card count; dupes=${result.duplicates}`).toBe(52);
  expect(result.unique, `seed ${seed}, action ${actionNo}: unique cards; dupes=${result.duplicates}`).toBe(52);
  if (result.phase === 'play') {
    expect(result.currentOut, `seed ${seed}, action ${actionNo}: current player cannot be OUT`).toBe(false);
  }
}

async function openSeededGame(browser, seed) {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
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
  await oliver.locator('.room-lobby-primary').click();
  await Promise.all(pages.map((page) => page.waitForFunction(() => state.phase === 'setup')));
  await restoreRandom(oliver);

  // Setup itself remains real UI: all three players independently press READY.
  for (const name of PLAYER_NAMES) {
    await byName[name].locator('.setup-ready').click();
    if (name !== 'Chris') {
      await expect.poll(() => oliver.evaluate((n) => !!state.setupReady?.[n], name), { timeout: 2500 }).toBe(true);
    }
  }

  await Promise.all(pages.map((page) => page.waitForFunction(() => state.phase === 'play')));
  await expectAllSynced(pages, seed, 0);
  await assertCardConservation(oliver, seed, 0);
  log(seed, `started; opener=${await oliver.evaluate(() => state.currentPlayer)}`);
  return { context, pages, byName, host: oliver };
}

async function chooseAction(page, playerName) {
  return page.evaluate((name) => {
    const api = window.ShitHeadTablePlay;
    const player = state.players[name];
    const slots = api.getSlots(name);
    const order = ['4', '5', '6', '7', '8', '9', 'J', 'Q', 'K', 'A', '2', '3', '10'];

    function groups(zone, cards) {
      const grouped = new Map();
      cards.forEach((card, index) => {
        if (!card) return;
        if (!grouped.has(card.rank)) grouped.set(card.rank, []);
        grouped.get(card.rank).push({ zone, index });
      });
      return [...grouped.entries()].map(([rank, refs]) => ({ rank, refs }));
    }

    function priority(rank) {
      if (rank === '10') return -30;
      if (rank === '2') return -20;
      if (rank === '3') return -10;
      return order.indexOf(rank);
    }

    function best(options) {
      return options
        .filter((option) => api.validateRefs(name, option.refs).ok)
        .sort((a, b) => b.refs.length - a.refs.length || priority(a.rank) - priority(b.rank))[0] || null;
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
      const chosen = best(groups('hand', player.hand));
      if (chosen) return { type: 'play', refs: chosen.refs };
    } else {
      const chosen = best(groups('faceUp', slots.map((slot) => slot.faceUp)));
      if (chosen) return { type: 'play', refs: chosen.refs };
      const blindIndex = slots.findIndex((_, index) => api.canBlind(name, index));
      if (blindIndex >= 0) return { type: 'blind', slotIndex: blindIndex };
    }

    if (state.discard.length) return { type: 'pickup' };
    return {
      type: 'stuck',
      snapshot: {
        player: name,
        hand: player.hand.map((card) => `${card.rank}${card.suit}`),
        table: slots.map((slot) => ({ up: slot.faceUp ? `${slot.faceUp.rank}${slot.faceUp.suit}` : null, down: !!slot.faceDown })),
        draw: state.drawPile.length,
        discard: state.discard.length,
        followUpRank: state.followUpRank || null,
      },
    };
  }, playerName);
}

async function dispatchAction(page, action) {
  return page.evaluate((nextAction) => {
    const mp = window.ShitHeadMultiplayer;
    const role = mp.status.role;
    if (role === 'client') return mp.sendAction(nextAction);
    if (role !== 'host') return false;

    const name = mp.status.player;
    const api = window.ShitHeadTablePlay;
    let accepted = false;
    if (nextAction.type === 'play') accepted = api.playRefs(name, nextAction.refs) !== false;
    else if (nextAction.type === 'blind') accepted = api.playFaceDown(name, nextAction.slotIndex) !== false;
    else if (nextAction.type === 'pickup') { pickupDiscard(name); accepted = true; }
    else if (nextAction.type === 'finish') { finishTurn(name); accepted = true; }

    if (accepted) mp.publishState();
    return accepted;
  }, action);
}

async function snapshotForFailure(host) {
  if (host.isClosed()) return { pageClosed: true };
  return host.evaluate(() => ({
    phase: state.phase,
    currentPlayer: state.currentPlayer,
    draw: state.drawPile.length,
    discard: state.discard.map((card) => `${card.rank}${card.suit}`),
    burn: (state.burnPile || []).length,
    followUpRank: state.followUpRank || null,
    finishOrder: [...(state.finishOrder || [])],
    shitHead: state.shitHead || null,
    hands: Object.fromEntries(PLAYER_NAMES.map((name) => [name, state.players[name].hand.map((card) => `${card.rank}${card.suit}`)])),
    tables: Object.fromEntries(PLAYER_NAMES.map((name) => [name, window.ShitHeadTablePlay.getSlots(name).map((slot) => ({
      up: slot.faceUp ? `${slot.faceUp.rank}${slot.faceUp.suit}` : null,
      down: slot.faceDown ? `${slot.faceDown.rank}${slot.faceDown.suit}` : null,
    }))])),
    message: state.lastMessage,
  }));
}

async function runGame(browser, seed) {
  const { context, pages, byName, host } = await openSeededGame(browser, seed);
  let actions = 0;
  let lastAction = null;
  const counts = { play: 0, blind: 0, pickup: 0, finish: 0 };

  try {
    while (actions < MAX_ACTIONS) {
      const phase = await host.evaluate(() => state.phase);
      if (phase === 'gameover') break;
      expect(phase, `seed ${seed}, action ${actions}: expected play/gameover`).toBe('play');

      const player = await host.evaluate(() => state.currentPlayer);
      expect(PLAYER_NAMES).toContain(player);
      const actor = byName[player];
      const before = await canonicalSignature(host);
      const action = await chooseAction(actor, player);
      lastAction = { player, action };
      if (action.type === 'stuck') throw new Error(`Bot has no legal action: ${JSON.stringify(action.snapshot)}`);
      if (counts[action.type] !== undefined) counts[action.type] += 1;

      const sent = await dispatchAction(actor, action);
      expect(sent, `seed ${seed}, action ${actions + 1}: ${player} ${action.type} was not dispatched`).toBe(true);
      actions += 1;

      await expect.poll(() => canonicalSignature(host), {
        timeout: 3000,
        intervals: [10, 20, 40, 80],
        message: `seed ${seed}, action ${actions}: host state did not change after ${player} ${action.type}`,
      }).not.toBe(before);

      await expectAllSynced(pages, seed, actions);
      await assertCardConservation(host, seed, actions);

      if (actions <= 5 || actions % 50 === 0) {
        const progress = await host.evaluate(() => ({
          phase: state.phase,
          current: state.currentPlayer,
          draw: state.drawPile.length,
          discard: state.discard.length,
          burn: (state.burnPile || []).length,
          hands: Object.fromEntries(PLAYER_NAMES.map((name) => [name, state.players[name].hand.length])),
          out: [...(state.finishOrder || [])],
        }));
        log(seed, `action ${actions}: ${player} ${action.type}; ${JSON.stringify(progress)}`);
      }
    }

    const end = await host.evaluate(() => ({
      phase: state.phase,
      shitHead: state.shitHead,
      finishOrder: [...state.finishOrder],
      scores: { ...state.scores },
      roundScored: state.roundScored,
    }));
    expect(end.phase, `seed ${seed}: exceeded ${MAX_ACTIONS} actions`).toBe('gameover');
    expect(PLAYER_NAMES).toContain(end.shitHead);
    expect(end.roundScored).toBe(true);
    expect(Object.values(end.scores).reduce((sum, value) => sum + Number(value || 0), 0)).toBe(1);
    expect(end.scores[end.shitHead]).toBe(1);
    await expectAllSynced(pages, seed, actions);
    await assertCardConservation(host, seed, actions);
    log(seed, `PASS in ${actions} actions; Shit Head=${end.shitHead}; counts=${JSON.stringify(counts)}`);
  } catch (error) {
    const snapshot = await snapshotForFailure(host).catch((snapshotError) => ({ snapshotError: String(snapshotError) }));
    console.error(`[bot seed ${seed}] FAILED after ${actions} actions; last=${JSON.stringify(lastAction)}; state=${JSON.stringify(snapshot)}`);
    throw error;
  } finally {
    await context.close().catch(() => {});
  }
}

for (const seed of SEEDS) {
  test(`seeded bots complete synchronized game ${seed}`, async ({ browser }) => {
    test.setTimeout(90000);
    await runGame(browser, seed);
  });
}
