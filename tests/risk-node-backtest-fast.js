'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const simulator = require('./risk-simulator.js');
const publicRisk = require('../shithead-public-risk-v1.js');
const beliefState = require('../shithead-belief-state-v1.js');

const PLAYERS = simulator.PLAYER_NAMES;
const TARGET_GAMES = Number(process.env.SHITHEAD_RISK_GAMES || 60);
const TUNE_GAMES = Math.floor(TARGET_GAMES * 2 / 3);
const MAX_ACTIONS = 2500;
const SAMPLE_EVERY = 2;
const EPSILON = 1e-9;

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function assertPublic(snapshot) {
  for (const player of Object.values(snapshot.players)) {
    for (const card of player.hand) assert.equal(card.rank, undefined, 'hidden hand leaked');
    for (const slot of player.tableSlots) {
      if (slot.faceDown) assert.equal(slot.faceDown.rank, undefined, 'face-down card leaked');
    }
  }
  for (const card of snapshot.drawPile) assert.equal(card.rank, undefined, 'draw-pile card leaked');
  const belief = beliefState.snapshot(snapshot);
  assert.equal(belief.allocationMatchesDeck, true, `belief allocation mismatch ${JSON.stringify(belief.hiddenSlots)}`);
}

function active(snapshot) {
  return PLAYERS.filter((name) => {
    const player = snapshot.players[name];
    return player.hand.length + player.tableSlots.filter((slot) => slot.faceUp).length + player.tableSlots.filter((slot) => slot.faceDown).length > 0;
  });
}

function equalOdds(snapshot) {
  const living = active(snapshot);
  const p = living.length ? 100 / living.length : 0;
  return Object.fromEntries(PLAYERS.map((name) => [name, living.includes(name) ? p : 0]));
}

function score(probabilities, loser) {
  const p = Math.max(EPSILON, Math.min(1, (probabilities[loser] || 0) / 100));
  const logLoss = -Math.log(p);
  const brier = PLAYERS.reduce((sum, name) => {
    const predicted = (probabilities[name] || 0) / 100;
    return sum + (predicted - (name === loser ? 1 : 0)) ** 2;
  }, 0);
  const max = Math.max(...PLAYERS.map((name) => probabilities[name] || 0));
  const leaders = PLAYERS.filter((name) => Math.abs((probabilities[name] || 0) - max) < 1e-9);
  return { logLoss, brier, loserProbability: p * 100, topHit: leaders.includes(loser) ? 1 / leaders.length : 0 };
}

function evaluate(games, config) {
  const perGame = games.map((game) => {
    const modelRows = [];
    const baselineRows = [];
    for (const snapshot of game.samples) {
      modelRows.push(score(publicRisk.calculatePublicShitheadProbability(snapshot, config), game.loser));
      baselineRows.push(score(equalOdds(snapshot), game.loser));
    }
    return {
      logLoss: mean(modelRows.map((row) => row.logLoss)),
      brier: mean(modelRows.map((row) => row.brier)),
      loserProbability: mean(modelRows.map((row) => row.loserProbability)),
      topHit: mean(modelRows.map((row) => row.topHit)),
      baselineLogLoss: mean(baselineRows.map((row) => row.logLoss)),
      baselineBrier: mean(baselineRows.map((row) => row.brier)),
    };
  });
  return {
    games: games.length,
    positions: games.reduce((sum, game) => sum + game.samples.length, 0),
    logLoss: mean(perGame.map((row) => row.logLoss)),
    brier: mean(perGame.map((row) => row.brier)),
    loserProbability: mean(perGame.map((row) => row.loserProbability)),
    topHit: mean(perGame.map((row) => row.topHit)),
    baselineLogLoss: mean(perGame.map((row) => row.baselineLogLoss)),
    baselineBrier: mean(perGame.map((row) => row.baselineBrier)),
  };
}

function candidates() {
  const defaults = publicRisk.DEFAULTS;
  const result = [];
  for (const temperature of [12, 18, 24]) {
    for (const burdenScale of [0.75, 1, 1.25]) {
      for (const cardQualityWeight of [0.6, 0.9, 1.2]) {
        result.push({
          temperature,
          burden: {
            hand: defaults.burden.hand * burdenScale,
            faceUp: defaults.burden.faceUp * burdenScale,
            faceDown: defaults.burden.faceDown * burdenScale,
          },
          cardQualityWeight,
          pickupLogWeight: defaults.pickupLogWeight,
        });
      }
    }
  }
  return result;
}

function calibration(games, config) {
  const bins = Array.from({ length: 10 }, (_, i) => ({ from: i * 10, to: (i + 1) * 10, predicted: [], actual: [] }));
  for (const game of games) {
    for (const snapshot of game.samples) {
      const probabilities = publicRisk.calculatePublicShitheadProbability(snapshot, config);
      for (const name of PLAYERS) {
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

function stageMetrics(games, config) {
  const aggregate = { early: [], middle: [], late: [] };
  for (const game of games) {
    const local = { early: [], middle: [], late: [] };
    const last = Math.max(1, game.samples.length - 1);
    game.samples.forEach((snapshot, index) => {
      const fraction = index / last;
      const stage = fraction < 1 / 3 ? 'early' : fraction < 2 / 3 ? 'middle' : 'late';
      local[stage].push(score(publicRisk.calculatePublicShitheadProbability(snapshot, config), game.loser));
    });
    for (const stage of Object.keys(local)) {
      aggregate[stage].push({
        logLoss: mean(local[stage].map((row) => row.logLoss)),
        loserProbability: mean(local[stage].map((row) => row.loserProbability)),
        topHit: mean(local[stage].map((row) => row.topHit)),
      });
    }
  }
  return Object.fromEntries(Object.entries(aggregate).map(([stage, rows]) => [stage, {
    logLoss: mean(rows.map((row) => row.logLoss)),
    loserProbability: mean(rows.map((row) => row.loserProbability)),
    topHit: mean(rows.map((row) => row.topHit)),
  }]));
}

function improvement(reference, candidate) {
  return reference ? ((reference - candidate) / reference) * 100 : 0;
}

function run() {
  const started = Date.now();
  const games = [];
  const skipped = [];
  for (let seed = 1; games.length < TARGET_GAMES && seed <= 500; seed += 1) {
    const game = simulator.runGame(seed, { maxActions: MAX_ACTIONS, sampleEvery: SAMPLE_EVERY });
    if (!game.completed) {
      skipped.push({ seed, actions: game.actions, reason: game.reason });
      continue;
    }
    for (const snapshot of game.samples) assertPublic(snapshot);
    games.push(game);
  }
  assert.equal(games.length, TARGET_GAMES, `only ${games.length} complete games`);

  const tune = games.slice(0, TUNE_GAMES);
  const holdout = games.slice(TUNE_GAMES);
  const defaultHoldout = evaluate(holdout, {});
  const ranked = candidates()
    .map((config) => ({ config, metrics: evaluate(tune, config) }))
    .sort((a, b) => a.metrics.logLoss - b.metrics.logLoss || a.metrics.brier - b.metrics.brier);
  const best = ranked[0];
  const tunedHoldout = evaluate(holdout, best.config);
  const positions = games.reduce((sum, game) => sum + game.samples.length, 0);
  assert.ok(positions >= 5000, `expected at least 5000 public positions, got ${positions}`);

  const report = {
    engine: publicRisk.version,
    simulator: 'pure-node-production-rules-v1',
    games: games.length,
    tuningGames: tune.length,
    holdoutGames: holdout.length,
    publicPositions: positions,
    elapsedMs: Date.now() - started,
    skipped,
    actionStats: {
      min: Math.min(...games.map((game) => game.actions)),
      max: Math.max(...games.map((game) => game.actions)),
      mean: mean(games.map((game) => game.actions)),
    },
    losers: Object.fromEntries(PLAYERS.map((name) => [name, games.filter((game) => game.loser === name).length])),
    bestTune: best,
    defaultHoldout,
    tunedHoldout,
    holdoutImprovementVsEqual: {
      defaultLogLossPercent: improvement(defaultHoldout.baselineLogLoss, defaultHoldout.logLoss),
      defaultBrierPercent: improvement(defaultHoldout.baselineBrier, defaultHoldout.brier),
      tunedLogLossPercent: improvement(tunedHoldout.baselineLogLoss, tunedHoldout.logLoss),
      tunedBrierPercent: improvement(tunedHoldout.baselineBrier, tunedHoldout.brier),
    },
    tunedVsDefault: {
      logLossPercent: improvement(defaultHoldout.logLoss, tunedHoldout.logLoss),
      brierPercent: improvement(defaultHoldout.brier, tunedHoldout.brier),
    },
    stages: stageMetrics(holdout, best.config),
    calibration: calibration(holdout, best.config),
    topFiveCandidates: ranked.slice(0, 5),
  };

  fs.mkdirSync(path.join(process.cwd(), 'test-results'), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), 'test-results', 'shithead-risk-node-backtest.json'), JSON.stringify(report, null, 2));

  assert.ok(Number.isFinite(defaultHoldout.logLoss));
  assert.ok(Number.isFinite(tunedHoldout.logLoss));
  console.log(`[risk-node] ${games.length} games / ${positions} public positions / ${report.elapsedMs}ms`);
  console.log(`[risk-node] losers ${JSON.stringify(report.losers)}`);
  console.log(`[risk-node] equal baseline: logLoss=${tunedHoldout.baselineLogLoss.toFixed(4)} brier=${tunedHoldout.baselineBrier.toFixed(4)}`);
  console.log(`[risk-node] default: logLoss=${defaultHoldout.logLoss.toFixed(4)} brier=${defaultHoldout.brier.toFixed(4)} topHit=${(defaultHoldout.topHit * 100).toFixed(1)}%`);
  console.log(`[risk-node] tuned: logLoss=${tunedHoldout.logLoss.toFixed(4)} brier=${tunedHoldout.brier.toFixed(4)} topHit=${(tunedHoldout.topHit * 100).toFixed(1)}%`);
  console.log(`[risk-node] tuned vs equal: logLoss=${report.holdoutImprovementVsEqual.tunedLogLossPercent.toFixed(2)}% brier=${report.holdoutImprovementVsEqual.tunedBrierPercent.toFixed(2)}%`);
  console.log(`[risk-node] best ${JSON.stringify(best.config)}`);
  console.log(`[risk-node] REPORT ${JSON.stringify(report)}`);
}

run();
