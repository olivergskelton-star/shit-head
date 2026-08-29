const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const publicRisk = require('../../shithead-public-risk-v1.js');
const beliefState = require('../../shithead-belief-state-v1.js');
const fakePeerSource = fs.readFileSync(path.join(__dirname, 'fake-peer.js'), 'utf8');

const PLAYER_NAMES = ['Oliver', 'Dan', 'Chris'];
const TARGET_COMPLETE_GAMES = 30;
const MAX_SEED = 120;
const MAX_ACTIONS = 1000;
const EPSILON = 1e-9;

function seededDealInit(seed) {
  return (value) => {
    let t = value >>> 0;
    const original = Math.random;
    Math.random = function seededRandomForDeal() {
      t += 0x6D2B79F5;
      let r = t;
      r = Math.imul(r ^ (r >>> 15), r | 1);
      r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
    window.__riskBacktestRestoreRandom = () => { Math.random = original; };
  };
}

async function openLocalSeededGame(context, seed) {
  const page = await context.newPage();
  await page.addInitScript(seededDealInit(seed), seed);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.ShitHeadTablePlay && state.phase === 'setup');
  await page.evaluate(() => window.__riskBacktestRestoreRandom?.());

  // Use the real local setup transition. No network is needed here because the
  // permanent three-browser suite separately proves synchronization/transport.
  await page.evaluate((names) => {
    for (const name of names) {
      state.viewer = name;
      markSetupReady(name);
    }
    state.viewer = names[0];
    render();
  }, PLAYER_NAMES);
  await page.waitForFunction(() => state.phase === 'play');
  return page;
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
          // The probability engine gets the hand SIZE but no unseen identity.
          hand: Array.from({ length: player.hand.length }, hidden),
          // Cards already seen entering this hand remain known to everybody.
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
      const players = Object.fromEntries(names.map((name) => {
        const player = state.players[name];
        const slots = api.getSlots(name);
        return [name, {
          hand: player.hand.map(id),
          table: slots.map((slot) => ({ up: id(slot.faceUp), down: id(slot.faceDown) })),
        }];
      }));
      return JSON.stringify({
        phase: state.phase,
        currentPlayer: state.currentPlayer,
        drawPile: state.drawPile.map(id),
        discard: state.discard.map(id),
        burnPile: (state.burnPile || []).map(id),
        followUpRank: state.followUpRank || null,
        finishOrder: [...(state.finishOrder || [])],
        players,
      });
    }

    function uniqueActions(candidateActions) {
      const seen = new Set();
      return candidateActions.filter((action) => {
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
      const result = [];
      grouped.forEach((refs) => {
        if (api.validateRefs(name, refs).ok) result.push({ type: 'play', refs });
        if (refs.length > 1 && api.validateRefs(name, [refs[0]]).ok) result.push({ type: 'play', refs: [refs[0]] });
      });
      return result;
    }

    function chooseAction(name, repeatCount) {
      const player = state.players[name];
      const slots = api.getSlots(name);
      let candidates = [];

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
        if (handRefs.length && api.validateRefs(name, handRefs).ok) candidates.push({ type: 'play', refs: handRefs });
        if (handRefs.length > 1 && api.validateRefs(name, [handRefs[0]]).ok) candidates.push({ type: 'play', refs: [handRefs[0]] });
        if (faceRefs.length && api.validateRefs(name, faceRefs).ok) candidates.push({ type: 'play', refs: faceRefs });
        candidates.push({ type: 'finish' });
      } else if (player.hand.length > 0 || state.drawPile.length > 0) {
        candidates.push(...playOptions(name, 'hand', player.hand));
      } else {
        candidates.push(...playOptions(name, 'faceUp', slots.map((slot) => slot.faceUp)));
        slots.forEach((_, index) => {
          if (api.canBlind(name, index)) candidates.push({ type: 'blind', slotIndex: index });
        });
      }

      candidates = uniqueActions(candidates);
      // The repeated-position branch is a deterministic cycle breaker. Voluntary
      // pickup is a legal house-rule action and stops simplistic bots looping forever.
      if (!state.followUpRank && state.discard.length > 0 && (!candidates.length || repeatCount > 1)) {
        candidates.push({ type: 'pickup' });
      }
      if (!candidates.length) return { type: 'stuck' };

      const baseIndex = Math.floor(random() * candidates.length) % candidates.length;
      return candidates[(baseIndex + Math.max(0, repeatCount - 1)) % candidates.length];
    }

    function dispatch(name, action) {
      if (action.type === 'play') return api.playRefs(name, action.refs) !== false;
      if (action.type === 'blind') return api.playFaceDown(name, action.slotIndex) !== false;
      if (action.type === 'pickup') { pickupDiscard(name); return true; }
      if (action.type === 'finish') { finishTurn(name); return true; }
      return false;
    }

    function updatePublicHandMemory(name, action, before) {
      const hand = state.players[name].hand;
      const currentIds = new Set(hand.map(id));
      const known = knownHandIds[name];

      // Drop public-memory cards that the player has just played/disposed of.
      for (const cardId of [...known]) {
        if (!currentIds.has(cardId)) known.delete(cardId);
      }

      // A voluntary pickup publicly transfers the whole visible pile into hand.
      if (action.type === 'pickup') {
        for (const cardId of before.discardIds) {
          if (currentIds.has(cardId)) known.add(cardId);
        }
      }

      // A failed blind reveals that blind card and the existing pile before they
      // enter the player's hand. If the blind was legal they won't be in hand,
      // so this adds nothing.
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

async function playOneGame(context, seed) {
  const page = await openLocalSeededGame(context, seed);
  try {
    return { seed, ...(await runGameInsidePage(page, seed)) };
  } finally {
    await page.close();
  }
}

function assertSnapshotIsPublic(snapshot) {
  for (const player of Object.values(snapshot.players)) {
    for (const card of player.hand) {
      expect(card.rank, 'genuinely hidden hand rank leaked into backtest input').toBeUndefined();
    }
    expect(player.knownHand.length).toBeLessThanOrEqual(player.hand.length);
    for (const card of player.knownHand) expect(typeof card.rank).toBe('string');
    for (const slot of player.tableSlots) {
      if (slot.faceDown) expect(slot.faceDown.rank, 'face-down rank leaked into backtest input').toBeUndefined();
    }
  }
  for (const card of snapshot.drawPile) {
    expect(card.rank, 'draw-pile rank leaked into backtest input').toBeUndefined();
  }

  // If this fails we have either forgotten a public card or double-counted one.
  const belief = beliefState.snapshot(snapshot);
  expect(belief.allocationMatchesDeck, `belief allocation mismatch: ${JSON.stringify(belief.hiddenSlots)}`).toBe(true);
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
  const best = Math.max(...PLAYER_NAMES.map((name) => probabilities[name] || 0));
  const leaders = PLAYER_NAMES.filter((name) => Math.abs((probabilities[name] || 0) - best) < 1e-9);
  return {
    logLoss,
    brier,
    loserProbability: pLoser * 100,
    topHit: leaders.includes(loser) ? 1 / leaders.length : 0,
  };
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function evaluateModel(games, config) {
  const perGame = games.map((game) => {
    const rows = game.samples.map((snapshot) => {
      const model = scoreOne(publicRisk.calculatePublicShitheadProbability(snapshot, config), game.loser);
      const baseline = scoreOne(equalBaseline(snapshot), game.loser);
      return { model, baseline };
    });
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

function stageReport(games, config) {
  const gameStages = games.map((game) => {
    const buckets = { early: [], middle: [], late: [] };
    const last = Math.max(1, game.samples.length - 1);
    game.samples.forEach((snapshot, index) => {
      const fraction = index / last;
      const stage = fraction < 1 / 3 ? 'early' : fraction < 2 / 3 ? 'middle' : 'late';
      buckets[stage].push(scoreOne(publicRisk.calculatePublicShitheadProbability(snapshot, config), game.loser));
    });
    return Object.fromEntries(Object.entries(buckets).map(([stage, rows]) => [stage, {
      logLoss: mean(rows.map((row) => row.logLoss)),
      brier: mean(rows.map((row) => row.brier)),
      loserProbability: mean(rows.map((row) => row.loserProbability)),
      topHit: mean(rows.map((row) => row.topHit)),
    }]));
  });

  return Object.fromEntries(['early', 'middle', 'late'].map((stage) => [stage, {
    games: games.length,
    logLoss: mean(gameStages.map((row) => row[stage].logLoss)),
    brier: mean(gameStages.map((row) => row[stage].brier)),
    loserProbability: mean(gameStages.map((row) => row[stage].loserProbability)),
    topHit: mean(gameStages.map((row) => row[stage].topHit)),
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
      const probs = publicRisk.calculatePublicShitheadProbability(snapshot, config);
      for (const name of PLAYER_NAMES) {
        const p = Math.max(0, Math.min(99.999999, probs[name] || 0));
        const bin = bins[Math.floor(p / 10)];
        bin.predicted.push(p);
        bin.actual.push(name === game.loser ? 1 : 0);
      }
    }
  }
  return bins
    .filter((bin) => bin.predicted.length)
    .map((bin) => ({
      range: `${bin.from}-${bin.to}`,
      n: bin.predicted.length,
      meanPredicted: mean(bin.predicted),
      observedPercent: mean(bin.actual) * 100,
    }));
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

function improvement(reference, candidate) {
  if (!reference) return 0;
  return ((reference - candidate) / reference) * 100;
}

test('public Shithead risk is backtested against complete seeded games without hidden-card access', async ({ browser }) => {
  test.setTimeout(240000);
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  await context.route('https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: fakePeerSource });
  });

  const completeGames = [];
  const skipped = [];
  try {
    for (let seed = 1; seed <= MAX_SEED && completeGames.length < TARGET_COMPLETE_GAMES; seed += 1) {
      const game = await playOneGame(context, seed);
      if (game.completed) {
        expect(PLAYER_NAMES).toContain(game.loser);
        for (const snapshot of game.samples) assertSnapshotIsPublic(snapshot);
        completeGames.push(game);
        console.log(`[risk-backtest] seed ${seed} complete: ${game.actions} actions; Shit Head=${game.loser}; samples=${game.samples.length}`);
      } else {
        skipped.push({ seed, actions: game.actions, reason: game.reason });
        console.log(`[risk-backtest] seed ${seed} skipped after ${game.actions} actions: ${game.reason}`);
      }
    }
  } finally {
    await context.close();
  }

  expect(completeGames.length, `only ${completeGames.length} complete games; skipped=${JSON.stringify(skipped)}`).toBeGreaterThanOrEqual(24);

  // Select weights on one set of games and report them on a different set. This
  // prevents us congratulating ourselves for merely over-fitting the same deals.
  const trainCount = Math.max(16, Math.floor(completeGames.length * 2 / 3));
  const trainingGames = completeGames.slice(0, trainCount);
  const validationGames = completeGames.slice(trainCount);

  const defaultAll = evaluateModel(completeGames, {});
  const defaultTraining = evaluateModel(trainingGames, {});
  const defaultValidation = evaluateModel(validationGames, {});

  const rankedTraining = candidateConfigs()
    .map((config) => ({ config, metrics: evaluateModel(trainingGames, config) }))
    .sort((a, b) => a.metrics.logLoss - b.metrics.logLoss || a.metrics.brier - b.metrics.brier);
  const best = rankedTraining[0];
  const tunedValidation = evaluateModel(validationGames, best.config);

  const report = {
    engine: publicRisk.version,
    beliefEngine: beliefState.version,
    completedGames: completeGames.length,
    trainingGames: trainingGames.length,
    validationGames: validationGames.length,
    skipped,
    actionCounts: completeGames.map((game) => game.actions),
    loserCounts: Object.fromEntries(PLAYER_NAMES.map((name) => [name, completeGames.filter((game) => game.loser === name).length])),
    defaultAll,
    training: {
      default: defaultTraining,
      bestGridCandidate: best,
      improvementVsDefault: {
        logLossPercent: improvement(defaultTraining.logLoss, best.metrics.logLoss),
        brierPercent: improvement(defaultTraining.brier, best.metrics.brier),
      },
    },
    validation: {
      default: defaultValidation,
      tuned: tunedValidation,
      tunedVsDefault: {
        logLossPercent: improvement(defaultValidation.logLoss, tunedValidation.logLoss),
        brierPercent: improvement(defaultValidation.brier, tunedValidation.brier),
      },
      tunedVsEqualBaseline: {
        logLossPercent: improvement(tunedValidation.baselineLogLoss, tunedValidation.logLoss),
        brierPercent: improvement(tunedValidation.baselineBrier, tunedValidation.brier),
      },
      defaultVsEqualBaseline: {
        logLossPercent: improvement(defaultValidation.baselineLogLoss, defaultValidation.logLoss),
        brierPercent: improvement(defaultValidation.baselineBrier, defaultValidation.brier),
      },
    },
    stagesDefaultValidation: stageReport(validationGames, {}),
    stagesTunedValidation: stageReport(validationGames, best.config),
    calibrationTunedValidation: calibrationReport(validationGames, best.config),
    topFiveTrainingCandidates: rankedTraining.slice(0, 5),
  };

  fs.mkdirSync('test-results', { recursive: true });
  fs.writeFileSync('test-results/shithead-risk-backtest.json', JSON.stringify(report, null, 2));
  console.log(`[risk-backtest] REPORT ${JSON.stringify(report)}`);

  // This pass is observational. We are measuring whether the model beats equal
  // odds; we are not making CI green depend on an as-yet uncalibrated threshold.
  expect(Number.isFinite(defaultAll.logLoss)).toBe(true);
  expect(Number.isFinite(tunedValidation.logLoss)).toBe(true);
});