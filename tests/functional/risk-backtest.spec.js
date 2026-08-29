const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const publicRisk = require('../../shithead-public-risk-v1.js');
const fakePeerSource = fs.readFileSync(path.join(__dirname, 'fake-peer.js'), 'utf8');

const PLAYER_NAMES = ['Oliver', 'Dan', 'Chris'];
const TARGET_COMPLETE_GAMES = 30;
const MAX_SEED = 90;
const MAX_ACTIONS = 900;
const EPSILON = 1e-9;

function seededRandom(seed) {
  let t = (seed ^ 0x9E3779B9) >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

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

  // Exercise the real setup transition, but without network transport: each local
  // player becomes the viewer just long enough to press READY in deterministic order.
  await page.evaluate(() => {
    for (const name of PLAYER_NAMES) {
      state.viewer = name;
      markSetupReady(name);
    }
    state.viewer = 'Oliver';
    render();
  });
  await page.waitForFunction(() => state.phase === 'play');
  return page;
}

async function actualPositionSignature(page) {
  return page.evaluate(() => {
    const id = (card) => card ? `${card.rank}${card.suit}` : null;
    const players = Object.fromEntries(PLAYER_NAMES.map((name) => {
      const player = state.players[name];
      const slots = window.ShitHeadTablePlay.getSlots(name);
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
  });
}

async function publicSnapshot(page) {
  return page.evaluate(() => {
    const publicCard = (card) => card ? { rank: card.rank, suit: card.suit } : null;
    const hidden = () => ({ hidden: true });
    const players = Object.fromEntries(PLAYER_NAMES.map((name) => {
      const player = state.players[name];
      const slots = window.ShitHeadTablePlay.getSlots(name);
      return [name, {
        // Deliberately erase all hidden identities before the probability engine
        // ever sees this object. Only zone sizes survive.
        hand: Array.from({ length: player.hand.length }, hidden),
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
  });
}

function assertSnapshotIsPublic(snapshot) {
  for (const player of Object.values(snapshot.players)) {
    for (const card of player.hand) expect(card.rank, 'hidden hand rank leaked into backtest input').toBeUndefined();
    for (const slot of player.tableSlots) {
      if (slot.faceDown) expect(slot.faceDown.rank, 'face-down rank leaked into backtest input').toBeUndefined();
    }
  }
  for (const card of snapshot.drawPile) expect(card.rank, 'draw-pile rank leaked into backtest input').toBeUndefined();
}

async function chooseAction(page, playerName, randomValue, repeatCount) {
  return page.evaluate(({ name, random, repeats }) => {
    const api = window.ShitHeadTablePlay;
    const player = state.players[name];
    const slots = api.getSlots(name);

    function uniqueActions(actions) {
      const seen = new Set();
      return actions.filter((action) => {
        const key = JSON.stringify(action);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    function playOptions(zone, cards) {
      const grouped = new Map();
      cards.forEach((card, index) => {
        if (!card) return;
        if (!grouped.has(card.rank)) grouped.set(card.rank, []);
        grouped.get(card.rank).push({ zone, index });
      });
      const actions = [];
      grouped.forEach((refs) => {
        if (api.validateRefs(name, refs).ok) actions.push({ type: 'play', refs });
        if (refs.length > 1 && api.validateRefs(name, [refs[0]]).ok) actions.push({ type: 'play', refs: [refs[0]] });
      });
      return actions;
    }

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
      if (handRefs.length > 1 && api.validateRefs(name, [handRefs[0]]).ok) actions.push({ type: 'play', refs: [handRefs[0]] });
      if (faceRefs.length && api.validateRefs(name, faceRefs).ok) actions.push({ type: 'play', refs: faceRefs });
      actions.push({ type: 'finish' });
    } else if (player.hand.length > 0 || state.drawPile.length > 0) {
      actions.push(...playOptions('hand', player.hand));
    } else {
      actions.push(...playOptions('faceUp', slots.map((slot) => slot.faceUp)));
      slots.forEach((_, index) => {
        if (api.canBlind(name, index)) actions.push({ type: 'blind', slotIndex: index });
      });
    }

    actions = uniqueActions(actions);
    if (!state.followUpRank && state.discard.length > 0 && (!actions.length || repeats > 1)) actions.push({ type: 'pickup' });
    if (!actions.length) return { type: 'stuck' };

    const baseIndex = Math.floor(random * actions.length) % actions.length;
    const index = (baseIndex + Math.max(0, repeats - 1)) % actions.length;
    return actions[index];
  }, { name: playerName, random: randomValue, repeats: repeatCount });
}

async function dispatchLocalAction(page, player, action) {
  return page.evaluate(({ name, nextAction }) => {
    const api = window.ShitHeadTablePlay;
    if (nextAction.type === 'play') return api.playRefs(name, nextAction.refs) !== false;
    if (nextAction.type === 'blind') return api.playFaceDown(name, nextAction.slotIndex) !== false;
    if (nextAction.type === 'pickup') { pickupDiscard(name); return true; }
    if (nextAction.type === 'finish') { finishTurn(name); return true; }
    return false;
  }, { name: player, nextAction: action });
}

async function playOneGame(context, seed) {
  const page = await openLocalSeededGame(context, seed);
  const rng = seededRandom(seed);
  const seen = new Map();
  const samples = [];
  let actions = 0;

  try {
    while (actions < MAX_ACTIONS) {
      const phase = await page.evaluate(() => state.phase);
      if (phase === 'gameover') break;
      expect(phase).toBe('play');

      const snapshot = await publicSnapshot(page);
      assertSnapshotIsPublic(snapshot);
      samples.push(snapshot);

      const player = await page.evaluate(() => state.currentPlayer);
      const position = await actualPositionSignature(page);
      const repeats = (seen.get(position) || 0) + 1;
      seen.set(position, repeats);
      const action = await chooseAction(page, player, rng(), repeats);
      if (action.type === 'stuck') throw new Error(`seed ${seed}: bot stuck at action ${actions}`);
      const accepted = await dispatchLocalAction(page, player, action);
      if (!accepted) throw new Error(`seed ${seed}: ${player} ${action.type} rejected at action ${actions + 1}`);
      actions += 1;
    }

    const end = await page.evaluate(() => ({ phase: state.phase, shitHead: state.shitHead || null }));
    if (end.phase !== 'gameover') return { seed, completed: false, actions, samples: [] };
    expect(PLAYER_NAMES).toContain(end.shitHead);
    return { seed, completed: true, actions, loser: end.shitHead, samples };
  } finally {
    await page.close();
  }
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
  return { logLoss, brier, loserProbability: pLoser * 100, topHit: leaders.includes(loser) ? 1 / leaders.length : 0 };
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
  const bins = Array.from({ length: 10 }, (_, index) => ({ from: index * 10, to: (index + 1) * 10, predicted: [], actual: [] }));
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

test('public Shithead risk is backtested against complete seeded games without hidden-card access', async ({ browser }) => {
  test.setTimeout(180000);
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
        completeGames.push(game);
        console.log(`[risk-backtest] seed ${seed} complete: ${game.actions} actions; Shit Head=${game.loser}; samples=${game.samples.length}`);
      } else {
        skipped.push({ seed, actions: game.actions });
        console.log(`[risk-backtest] seed ${seed} skipped after ${game.actions} actions without gameover`);
      }
    }
  } finally {
    await context.close();
  }

  expect(completeGames.length, `only ${completeGames.length} complete games; skipped=${JSON.stringify(skipped)}`).toBeGreaterThanOrEqual(20);

  const defaultResult = evaluateModel(completeGames, {});
  const ranked = candidateConfigs()
    .map((config) => ({ config, metrics: evaluateModel(completeGames, config) }))
    .sort((a, b) => a.metrics.logLoss - b.metrics.logLoss || a.metrics.brier - b.metrics.brier);
  const best = ranked[0];

  const report = {
    engine: publicRisk.version,
    completedGames: completeGames.length,
    skipped,
    actionCounts: completeGames.map((game) => game.actions),
    default: defaultResult,
    bestGridCandidate: best,
    improvementVsDefault: {
      logLossPercent: ((defaultResult.logLoss - best.metrics.logLoss) / defaultResult.logLoss) * 100,
      brierPercent: ((defaultResult.brier - best.metrics.brier) / defaultResult.brier) * 100,
    },
    improvementVsEqualBaseline: {
      defaultLogLossPercent: ((defaultResult.baselineLogLoss - defaultResult.logLoss) / defaultResult.baselineLogLoss) * 100,
      defaultBrierPercent: ((defaultResult.baselineBrier - defaultResult.brier) / defaultResult.baselineBrier) * 100,
      bestLogLossPercent: ((defaultResult.baselineLogLoss - best.metrics.logLoss) / defaultResult.baselineLogLoss) * 100,
      bestBrierPercent: ((defaultResult.baselineBrier - best.metrics.brier) / defaultResult.baselineBrier) * 100,
    },
    stagesDefault: stageReport(completeGames, {}),
    stagesBest: stageReport(completeGames, best.config),
    calibrationBest: calibrationReport(completeGames, best.config),
    topFiveCandidates: ranked.slice(0, 5),
  };

  fs.mkdirSync('test-results', { recursive: true });
  fs.writeFileSync('test-results/shithead-risk-backtest.json', JSON.stringify(report, null, 2));
  console.log(`[risk-backtest] REPORT ${JSON.stringify(report)}`);

  // This first calibration run is observational: it must prove the pipeline and
  // privacy boundary, not force our uncalibrated heuristic to beat the baseline.
  expect(Number.isFinite(defaultResult.logLoss)).toBe(true);
  expect(Number.isFinite(best.metrics.logLoss)).toBe(true);
});
