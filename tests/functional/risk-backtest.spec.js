const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const publicRisk = require('../../shithead-public-risk-v1.js');
const beliefState = require('../../shithead-belief-state-v1.js');
const fakePeerSource = fs.readFileSync(path.join(__dirname, 'fake-peer.js'), 'utf8');

const PLAYER_NAMES = ['Oliver', 'Dan', 'Chris'];
const TARGET_COMPLETE_GAMES = 30;
const TUNE_GAMES = 20;
const MAX_SEED = 120;
const MAX_ACTIONS = 1000;
const EPSILON = 1e-9;

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

async function resetSeededGame(page, seed) {
  return page.evaluate(({ names, dealSeed }) => {
    let t = dealSeed >>> 0;
    const originalRandom = Math.random;
    Math.random = function seededDealRandom() {
      t += 0x6D2B79F5;
      let r = t;
      r = Math.imul(r ^ (r >>> 15), r | 1);
      r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };

    try {
      dealNewGame();
    } finally {
      Math.random = originalRandom;
    }

    for (const name of names) {
      state.viewer = name;
      markSetupReady(name);
    }
    state.viewer = names[0];

    return {
      phase: state.phase,
      currentPlayer: state.currentPlayer,
    };
  }, { names: PLAYER_NAMES, dealSeed: seed });
}

async function runGameInsidePage(page, seed) {
  return page.evaluate(({ names, botSeed, maxActions }) => {
    const api = window.ShitHeadTablePlay;
    const knownHandIds = Object.fromEntries(names.map((name) => [name, new Set()]));
    const seenPositions = new Map();
    const samples = [];
    let actions = 0;

    let rngState = (botSeed ^ 0x9E3779B9) >>> 0;
    function random() {
      rngState += 0x6D2B79F5;
      let r = rngState;
      r = Math.imul(r ^ (r >>> 15), r | 1);
      r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    }

    function id(card) {
      return card ? `${card.rank}|${card.suit}` : null;
    }

    function publicCard(card) {
      return card ? { rank: card.rank, suit: card.suit } : null;
    }

    function hidden() {
      return { hidden: true };
    }

    function publicSnapshot() {
      const players = Object.fromEntries(names.map((name) => {
        const player = state.players[name];
        const slots = api.getSlots(name);
        const known = knownHandIds[name];
        return [name, {
          // The model gets hand size, never the identity of a genuinely unseen card.
          hand: Array.from({ length: player.hand.length }, hidden),
          // Publicly revealed cards stay known if they subsequently enter a hand.
          knownHand: player.hand.filter((card) => known.has(id(card))).map(publicCard),
          tableSlots: slots.map((slot) => ({
            faceUp: publicCard(slot.faceUp),
            faceDown: slot.faceDown ? hidden() : null,
          })),
        }];
      }));

      return {
        phase: state.phase,
        currentPlayer: state.currentPlayer,
        followUpRank: state.followUpRank || null,
        drawPile: Array.from({ length: state.drawPile.length }, hidden),
        discard: state.discard.map(publicCard),
        burnPile: (state.burnPile || []).map(publicCard),
        finishOrder: [...(state.finishOrder || [])],
        players,
      };
    }

    function positionSignature() {
      const parts = [state.currentPlayer, state.followUpRank || '-', String(state.drawPile.length)];
      parts.push(state.discard.map(id).join(','));
      for (const name of names) {
        const slots = api.getSlots(name);
        parts.push(name);
        parts.push(state.players[name].hand.map(id).join(','));
        parts.push(slots.map((slot) => `${id(slot.faceUp) || '-'}>${id(slot.faceDown) || '-'}`).join(','));
      }
      return parts.join('~');
    }

    function uniqueActions(actions) {
      const seen = new Set();
      return actions.filter((action) => {
        const key = JSON.stringify(action);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    function playOptions(name, zone, cards) {
      const grouped = new Map();
      cards.forEach((card, index) => {
        if (!card) return;
        if (!grouped.has(card.rank)) grouped.set(card.rank, []);
        grouped.get(card.rank).push({ zone, index });
      });

      const actions = [];
      grouped.forEach((refs) => {
        if (api.validateRefs(name, refs).ok) actions.push({ type: 'play', refs });
        if (refs.length > 1 && api.validateRefs(name, [refs[0]]).ok) {
          actions.push({ type: 'play', refs: [refs[0]] });
        }
      });
      return actions;
    }

    function chooseAction(name, repeatCount) {
      const player = state.players[name];
      const slots = api.getSlots(name);
      let actions = [];

      if (state.followUpRank) {
        const rank = state.followUpRank;
        const handRefs = player.hand
          .map((card, index) => ({ card, index }))
          .filter(({ card }) => card.rank === rank)
          .map(({ index }) => ({ zone: 'hand', index }));
        const faceRefs = slots
          .map((slot, index) => ({ card: slot.faceUp, index }))
          .filter(({ card }) => card?.rank === rank)
          .map(({ index }) => ({ zone: 'faceUp', index }));

        if (handRefs.length && api.validateRefs(name, handRefs).ok) actions.push({ type: 'play', refs: handRefs });
        if (handRefs.length > 1 && api.validateRefs(name, [handRefs[0]]).ok) {
          actions.push({ type: 'play', refs: [handRefs[0]] });
        }
        if (faceRefs.length && api.validateRefs(name, faceRefs).ok) actions.push({ type: 'play', refs: faceRefs });
        actions.push({ type: 'finish' });
      } else if (player.hand.length > 0 || state.drawPile.length > 0) {
        actions.push(...playOptions(name, 'hand', player.hand));
      } else {
        actions.push(...playOptions(name, 'faceUp', slots.map((slot) => slot.faceUp)));
        slots.forEach((_, index) => {
          if (api.canBlind(name, index)) actions.push({ type: 'blind', slotIndex: index });
        });
      }

      actions = uniqueActions(actions);
      // Voluntary pickup is legal. Use it as a deterministic cycle breaker for
      // deliberately simple bots when an identical position repeats.
      if (!state.followUpRank && state.discard.length > 0 && (!actions.length || repeatCount > 1)) {
        actions.push({ type: 'pickup' });
      }
      if (!actions.length) return { type: 'stuck' };

      const baseIndex = Math.floor(random() * actions.length) % actions.length;
      return actions[(baseIndex + Math.max(0, repeatCount - 1)) % actions.length];
    }

    function dispatch(name, action) {
      if (action.type === 'play') return api.playRefs(name, action.refs) !== false;
      if (action.type === 'blind') return api.playFaceDown(name, action.slotIndex) !== false;
      if (action.type === 'pickup') {
        pickupDiscard(name);
        return true;
      }
      if (action.type === 'finish') {
        finishTurn(name);
        return true;
      }
      return false;
    }

    function updatePublicHandMemory(name, action, before) {
      const hand = state.players[name].hand;
      const currentIds = new Set(hand.map(id));
      const known = knownHandIds[name];

      for (const cardId of [...known]) {
        if (!currentIds.has(cardId)) known.delete(cardId);
      }

      if (action.type === 'pickup') {
        for (const cardId of before.discardIds) {
          if (currentIds.has(cardId)) known.add(cardId);
        }
      }

      // A failed blind publicly reveals the blind card and pile before both enter
      // the hand. A successful blind never enters the hand, so adds nothing here.
      if (action.type === 'blind') {
        for (const cardId of before.discardIds) {
          if (currentIds.has(cardId)) known.add(cardId);
        }
        if (before.blindId && currentIds.has(before.blindId)) known.add(before.blindId);
      }
    }

    while (actions < maxActions && state.phase === 'play') {
      samples.push(publicSnapshot());

      const name = state.currentPlayer;
      const signature = positionSignature();
      const repeats = (seenPositions.get(signature) || 0) + 1;
      seenPositions.set(signature, repeats);
      const action = chooseAction(name, repeats);
      if (action.type === 'stuck') {
        return { completed: false, actions, reason: `bot stuck: ${name}`, samples: [] };
      }

      const slots = api.getSlots(name);
      const before = {
        discardIds: state.discard.map(id),
        blindId: action.type === 'blind' ? id(slots[action.slotIndex]?.faceDown) : null,
      };

      if (!dispatch(name, action)) {
        return { completed: false, actions, reason: `${name} ${action.type} rejected`, samples: [] };
      }
      updatePublicHandMemory(name, action, before);
      actions += 1;
    }

    if (state.phase !== 'gameover') {
      return { completed: false, actions, reason: `no gameover by ${maxActions}`, samples: [] };
    }

    return {
      completed: true,
      actions,
      loser: state.shitHead || null,
      samples,
    };
  }, { names: PLAYER_NAMES, botSeed: seed, maxActions: MAX_ACTIONS });
}

function assertSnapshotIsPublic(snapshot) {
  for (const player of Object.values(snapshot.players)) {
    for (const card of player.hand) {
      expect(card.rank, 'genuinely hidden hand rank leaked into model input').toBeUndefined();
    }
    expect(player.knownHand.length).toBeLessThanOrEqual(player.hand.length);
    for (const card of player.knownHand) expect(typeof card.rank).toBe('string');
    for (const slot of player.tableSlots) {
      if (slot.faceDown) expect(slot.faceDown.rank, 'face-down rank leaked into model input').toBeUndefined();
    }
  }
  for (const card of snapshot.drawPile) {
    expect(card.rank, 'draw-pile rank leaked into model input').toBeUndefined();
  }

  const belief = beliefState.snapshot(snapshot);
  expect(
    belief.allocationMatchesDeck,
    `belief allocation mismatch: ${JSON.stringify(belief.hiddenSlots)}`,
  ).toBe(true);
}

function activePlayerIds(snapshot) {
  return PLAYER_NAMES.filter((name) => {
    const player = snapshot.players[name];
    const faceUp = player.tableSlots.filter((slot) => !!slot.faceUp).length;
    const faceDown = player.tableSlots.filter((slot) => !!slot.faceDown).length;
    return player.hand.length + faceUp + faceDown > 0;
  });
}

function equalBaseline(snapshot) {
  const active = activePlayerIds(snapshot);
  const p = active.length ? 100 / active.length : 0;
  return Object.fromEntries(PLAYER_NAMES.map((name) => [name, active.includes(name) ? p : 0]));
}

function scoreOne(probabilities, loser) {
  const pLoser = Math.max(EPSILON, Math.min(1, (probabilities[loser] || 0) / 100));
  const logLoss = -Math.log(pLoser);
  const brier = PLAYER_NAMES.reduce((sum, name) => {
    const p = (probabilities[name] || 0) / 100;
    const y = name === loser ? 1 : 0;
    return sum + ((p - y) ** 2);
  }, 0);
  const highest = Math.max(...PLAYER_NAMES.map((name) => probabilities[name] || 0));
  const leaders = PLAYER_NAMES.filter((name) => Math.abs((probabilities[name] || 0) - highest) < 1e-9);
  return {
    logLoss,
    brier,
    loserProbability: pLoser * 100,
    topHit: leaders.includes(loser) ? 1 / leaders.length : 0,
  };
}

function evaluateModel(games, config) {
  const perGame = games.map((game) => {
    const rows = game.samples.map((snapshot) => ({
      model: scoreOne(publicRisk.calculatePublicShitheadProbability(snapshot, config), game.loser),
      baseline: scoreOne(equalBaseline(snapshot), game.loser),
    }));
    return {
      logLoss: mean(rows.map((row) => row.model.logLoss)),
      brier: mean(rows.map((row) => row.model.brier)),
      loserProbability: mean(rows.map((row) => row.model.loserProbability)),
      topHit: mean(rows.map((row) => row.model.topHit)),
      baselineLogLoss: mean(rows.map((row) => row.baseline.logLoss)),
      baselineBrier: mean(rows.map((row) => row.baseline.brier)),
    };
  });

  return {
    games: games.length,
    logLoss: mean(perGame.map((row) => row.logLoss)),
    brier: mean(perGame.map((row) => row.brier)),
    loserProbability: mean(perGame.map((row) => row.loserProbability)),
    topHit: mean(perGame.map((row) => row.topHit)),
    baselineLogLoss: mean(perGame.map((row) => row.baselineLogLoss)),
    baselineBrier: mean(perGame.map((row) => row.baselineBrier)),
  };
}

function candidateConfigs() {
  const defaults = publicRisk.DEFAULTS;
  const configs = [];
  for (const temperature of [12, 18, 24]) {
    for (const burdenScale of [0.75, 1, 1.25]) {
      for (const cardQualityWeight of [0.6, 0.9, 1.2]) {
        for (const pickupLogWeight of [3, 5, 7]) {
          configs.push({
            temperature,
            burden: {
              hand: defaults.burden.hand * burdenScale,
              faceUp: defaults.burden.faceUp * burdenScale,
              faceDown: defaults.burden.faceDown * burdenScale,
            },
            cardQualityWeight,
            pickupLogWeight,
          });
        }
      }
    }
  }
  return configs;
}

function stageReport(games, config) {
  const stages = { early: [], middle: [], late: [] };
  for (const game of games) {
    const last = Math.max(1, game.samples.length - 1);
    game.samples.forEach((snapshot, index) => {
      const fraction = index / last;
      const stage = fraction < 1 / 3 ? 'early' : fraction < 2 / 3 ? 'middle' : 'late';
      stages[stage].push(scoreOne(publicRisk.calculatePublicShitheadProbability(snapshot, config), game.loser));
    });
  }
  return Object.fromEntries(Object.entries(stages).map(([stage, rows]) => [stage, {
    samples: rows.length,
    logLoss: mean(rows.map((row) => row.logLoss)),
    brier: mean(rows.map((row) => row.brier)),
    loserProbability: mean(rows.map((row) => row.loserProbability)),
    topHit: mean(rows.map((row) => row.topHit)),
  }]));
}

function calibrationReport(games, config) {
  const bins = Array.from({ length: 10 }, (_, index) => ({
    from: index * 10,
    to: (index + 1) * 10,
    predicted: [],
    actual: [],
  }));

  for (const game of games) {
    for (const snapshot of game.samples) {
      const probabilities = publicRisk.calculatePublicShitheadProbability(snapshot, config);
      for (const name of PLAYER_NAMES) {
        const p = Math.max(0, Math.min(99.999999, probabilities[name] || 0));
        const bin = bins[Math.floor(p / 10)];
        bin.predicted.push(p);
        bin.actual.push(name === game.loser ? 1 : 0);
      }
    }
  }

  return bins.filter((bin) => bin.predicted.length).map((bin) => ({
    range: `${bin.from}-${bin.to}`,
    n: bin.predicted.length,
    meanPredicted: mean(bin.predicted),
    observedPercent: mean(bin.actual) * 100,
  }));
}

function improvement(reference, candidate) {
  return reference ? ((reference - candidate) / reference) * 100 : 0;
}

test('public Shithead probability calibration uses complete seeded games and a holdout set', async ({ browser }) => {
  test.setTimeout(600000);
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  await context.route('https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: fakePeerSource });
  });

  const page = await context.newPage();
  const completeGames = [];
  const skipped = [];

  try {
    await page.goto('/index.html');
    await page.waitForFunction(() => window.ShitHeadTablePlay && state.phase === 'setup');

    // Calibration needs the real rules/state transitions, not thousands of DOM
    // redraws. Game-over/out/turn decisions happen in the rules engine itself.
    await page.evaluate(() => {
      window.__riskBacktestOriginalRender = render;
      render = function riskBacktestNoopRender() {};
      window.render = render;
    });

    for (let seed = 1; seed <= MAX_SEED && completeGames.length < TARGET_COMPLETE_GAMES; seed += 1) {
      const reset = await resetSeededGame(page, seed);
      expect(reset.phase, `seed ${seed} failed to enter play`).toBe('play');

      const game = { seed, ...(await runGameInsidePage(page, seed)) };
      if (game.completed) {
        expect(PLAYER_NAMES).toContain(game.loser);
        for (const snapshot of game.samples) assertSnapshotIsPublic(snapshot);
        completeGames.push(game);
        console.log(`[risk-backtest] seed ${seed} complete: ${game.actions} actions; Shit Head=${game.loser}; samples=${game.samples.length}`);
      } else {
        skipped.push({ seed, actions: game.actions, reason: game.reason });
        console.log(`[risk-backtest] seed ${seed} skipped: ${game.actions} actions; ${game.reason}`);
      }
    }
  } finally {
    await page.close();
    await context.close();
  }

  expect(
    completeGames.length,
    `only ${completeGames.length} complete games; skipped=${JSON.stringify(skipped)}`,
  ).toBeGreaterThanOrEqual(TARGET_COMPLETE_GAMES);

  const tuningGames = completeGames.slice(0, TUNE_GAMES);
  const holdoutGames = completeGames.slice(TUNE_GAMES, TARGET_COMPLETE_GAMES);
  expect(holdoutGames.length).toBe(TARGET_COMPLETE_GAMES - TUNE_GAMES);

  const defaultTune = evaluateModel(tuningGames, {});
  const defaultHoldout = evaluateModel(holdoutGames, {});
  const ranked = candidateConfigs()
    .map((config) => ({ config, metrics: evaluateModel(tuningGames, config) }))
    .sort((a, b) => a.metrics.logLoss - b.metrics.logLoss || a.metrics.brier - b.metrics.brier);
  const best = ranked[0];
  const tunedHoldout = evaluateModel(holdoutGames, best.config);

  const report = {
    engine: publicRisk.version,
    completedGames: completeGames.length,
    tuningGames: tuningGames.map((game) => game.seed),
    holdoutGames: holdoutGames.map((game) => game.seed),
    skipped,
    actionCounts: completeGames.map((game) => game.actions),
    losers: completeGames.map((game) => ({ seed: game.seed, loser: game.loser })),
    defaultTune,
    bestTune: best,
    defaultHoldout,
    tunedHoldout,
    holdoutImprovementVsEqualBaseline: {
      defaultLogLossPercent: improvement(defaultHoldout.baselineLogLoss, defaultHoldout.logLoss),
      defaultBrierPercent: improvement(defaultHoldout.baselineBrier, defaultHoldout.brier),
      tunedLogLossPercent: improvement(tunedHoldout.baselineLogLoss, tunedHoldout.logLoss),
      tunedBrierPercent: improvement(tunedHoldout.baselineBrier, tunedHoldout.brier),
    },
    holdoutImprovementTunedVsDefault: {
      logLossPercent: improvement(defaultHoldout.logLoss, tunedHoldout.logLoss),
      brierPercent: improvement(defaultHoldout.brier, tunedHoldout.brier),
    },
    stagesDefaultHoldout: stageReport(holdoutGames, {}),
    stagesTunedHoldout: stageReport(holdoutGames, best.config),
    calibrationTunedHoldout: calibrationReport(holdoutGames, best.config),
    topFiveTuneCandidates: ranked.slice(0, 5),
  };

  fs.mkdirSync('test-results', { recursive: true });
  fs.writeFileSync('test-results/shithead-risk-backtest.json', JSON.stringify(report, null, 2));
  console.log(`[risk-backtest] REPORT ${JSON.stringify(report)}`);

  // This is still an observational calibration experiment. The holdout result may
  // beat or lose to equal odds; either outcome is useful evidence for the next model.
  expect(Number.isFinite(defaultHoldout.logLoss)).toBe(true);
  expect(Number.isFinite(tunedHoldout.logLoss)).toBe(true);
});