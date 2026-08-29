'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const simulator = require('./risk-simulator.js');
const publicRisk = require('../shithead-public-risk-v1.js');
const beliefState = require('../shithead-belief-state-v1.js');

const PLAYERS = simulator.PLAYER_NAMES;
const TARGET_GAMES = Number(process.env.SHITHEAD_RISK_GAMES || 100);
const TUNE_GAMES = Math.floor(TARGET_GAMES * 2 / 3);
const MAX_ACTIONS = 2500;
const SAMPLE_EVERY = 2;
const EPSILON = 1e-9;
const DEFAULTS = publicRisk.DEFAULTS;

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

function activeFromDetails(details) {
  return PLAYERS.filter((name) => Number.isFinite(details[name]?.riskScore));
}

function equalOddsFromDetails(details) {
  const active = activeFromDetails(details);
  const p = active.length ? 100 / active.length : 0;
  return Object.fromEntries(PLAYERS.map((name) => [name, active.includes(name) ? p : 0]));
}

function probabilitiesFromFeatures(details, config) {
  const active = activeFromDetails(details);
  if (!active.length) return Object.fromEntries(PLAYERS.map((name) => [name, 0]));
  if (active.length === 1) return Object.fromEntries(PLAYERS.map((name) => [name, name === active[0] ? 100 : 0]));

  const temperature = config.temperature;
  const cardQualityScale = config.cardQualityWeight / DEFAULTS.cardQualityWeight;
  const scores = Object.fromEntries(active.map((name) => {
    const c = details[name].components;
    const score = (c.burden * config.burdenScale)
      + (c.cardQuality * cardQualityScale)
      + c.tableTrap
      + (c.pickupDanger * config.pickupScale)
      - c.comboStrength;
    return [name, score];
  }));
  const maxScore = Math.max(...active.map((name) => scores[name]));
  const raw = Object.fromEntries(active.map((name) => [name, Math.exp((scores[name] - maxScore) / temperature)]));
  const denominator = active.reduce((sum, name) => sum + raw[name], 0) || 1;
  return Object.fromEntries(PLAYERS.map((name) => [name, active.includes(name) ? (raw[name] / denominator) * 100 : 0]));
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

function preprocessGame(game) {
  const rows = game.samples.map((snapshot) => {
    assertPublic(snapshot);
    const details = publicRisk.calculatePublicRiskDetails(snapshot, {});
    return {
      details,
      baseline: equalOddsFromDetails(details),
    };
  });
  return { seed: game.seed, loser: game.loser, actions: game.actions, rows };
}

function evaluate(games, config) {
  const perGame = games.map((game) => {
    const modelRows = [];
    const baselineRows = [];
    for (const row of game.rows) {
      modelRows.push(score(probabilitiesFromFeatures(row.details, config), game.loser));
      baselineRows.push(score(row.baseline, game.loser));
    }
    return {
      logLoss: mean(modelRows.map((item) => item.logLoss)),
      brier: mean(modelRows.map((item) => item.brier)),
      loserProbability: mean(modelRows.map((item) => item.loserProbability)),
      topHit: mean(modelRows.map((item) => item.topHit)),
      baselineLogLoss: mean(baselineRows.map((item) => item.logLoss)),
      baselineBrier: mean(baselineRows.map((item) => item.brier)),
    };
  });
  return {
    games: games.length,
    positions: games.reduce((sum, game) => sum + game.rows.length, 0),
    logLoss: mean(perGame.map((row) => row.logLoss)),
    brier: mean(perGame.map((row) => row.brier)),
    loserProbability: mean(perGame.map((row) => row.loserProbability)),
    topHit: mean(perGame.map((row) => row.topHit)),
    baselineLogLoss: mean(perGame.map((row) => row.baselineLogLoss)),
    baselineBrier: mean(perGame.map((row) => row.baselineBrier)),
  };
}

function candidates() {
  const configs = [];
  for (const temperature of [12, 18, 24]) {
    for (const burdenScale of [0.75, 1, 1.25]) {
      for (const cardQualityWeight of [0.6, 0.9, 1.2]) {
        for (const pickupScale of [0.7, 1, 1.3]) {
          configs.push({ temperature, burdenScale, cardQualityWeight, pickupScale });
        }
      }
    }
  }
  return configs;
}

function stageMetrics(games, config) {
  const aggregate = { early: [], middle: [], late: [] };
  for (const game of games) {
    const local = { early: [], middle: [], late: [] };
    const last = Math.max(1, game.rows.length - 1);
    game.rows.forEach((row, index) => {
      const fraction = index / last;
      const stage = fraction < 1 / 3 ? 'early' : fraction < 2 / 3 ? 'middle' : 'late';
      local[stage].push(score(probabilitiesFromFeatures(row.details, config), game.loser));
    });
    for (const stage of Object.keys(local)) {
      aggregate[stage].push({
        logLoss: mean(local[stage].map((item) => item.logLoss)),
        brier: mean(local[stage].map((item) => item.brier)),
        loserProbability: mean(local[stage].map((item) => item.loserProbability)),
        topHit: mean(local[stage].map((item) => item.topHit)),
      });
    }
  }
  return Object.fromEntries(Object.entries(aggregate).map(([stage, rows]) => [stage, {
    logLoss: mean(rows.map((row) => row.logLoss)),
    brier: mean(rows.map((row) => row.brier)),
    loserProbability: mean(rows.map((row) => row.loserProbability)),
    topHit: mean(rows.map((row) => row.topHit)),
  }]));
}

function calibration(games, config) {
  const bins = Array.from({ length: 10 }, (_, i) => ({ from: i * 10, to: (i + 1) * 10, predicted: [], actual: [] }));
  for (const game of games) {
    for (const row of game.rows) {
      const probabilities = probabilitiesFromFeatures(row.details, config);
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

function improvement(reference, candidate) {
  return reference ? ((reference - candidate) / reference) * 100 : 0;
}

function run() {
  const started = Date.now();
  const games = [];
  const skipped = [];
  for (let seed = 1; games.length < TARGET_GAMES && seed <= 1000; seed += 1) {
    const raw = simulator.runGame(seed, { maxActions: MAX_ACTIONS, sampleEvery: SAMPLE_EVERY });
    if (!raw.completed) {
      skipped.push({ seed, actions: raw.actions, reason: raw.reason });
      continue;
    }
    games.push(preprocessGame(raw));
  }
  assert.equal(games.length, TARGET_GAMES, `only ${games.length} complete games`);

  const tune = games.slice(0, TUNE_GAMES);
  const holdout = games.slice(TUNE_GAMES);
  const defaultConfig = { temperature: DEFAULTS.temperature, burdenScale: 1, cardQualityWeight: DEFAULTS.cardQualityWeight, pickupScale: 1 };
  const defaultHoldout = evaluate(holdout, defaultConfig);
  const ranked = candidates()
    .map((config) => ({ config, metrics: evaluate(tune, config) }))
    .sort((a, b) => a.metrics.logLoss - b.metrics.logLoss || a.metrics.brier - b.metrics.brier);
  const best = ranked[0];
  const tunedHoldout = evaluate(holdout, best.config);
  const positions = games.reduce((sum, game) => sum + game.rows.length, 0);
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
