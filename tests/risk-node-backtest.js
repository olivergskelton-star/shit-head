'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const simulator = require('./risk-simulator.js');
const publicRisk = require('../shithead-public-risk-v1.js');
const beliefState = require('../shithead-belief-state-v1.js');

const PLAYER_NAMES = simulator.PLAYER_NAMES;
const TARGET_GAMES = Number(process.env.SHITHEAD_RISK_GAMES || 150);
const TUNE_GAMES = Math.floor(TARGET_GAMES * 2 / 3);
const MAX_SEED = Math.max(TARGET_GAMES * 5, 500);
const MAX_ACTIONS = 2500;
const SAMPLE_EVERY = 2;
const EPSILON = 1e-9;

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
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

function assertSnapshotIsPublic(snapshot) {
  for (const player of Object.values(snapshot.players)) {
    for (const card of player.hand) assert.equal(card.rank, undefined, 'hidden hand rank leaked');
    assert.ok(player.knownHand.length <= player.hand.length, 'known hand exceeds hand count');
    for (const card of player.knownHand) assert.equal(typeof card.rank, 'string');
    for (const slot of player.tableSlots) {
      if (slot.faceDown) assert.equal(slot.faceDown.rank, undefined, 'face-down rank leaked');
    }
  }
  for (const card of snapshot.drawPile) assert.equal(card.rank, undefined, 'draw-pile rank leaked');
  const belief = beliefState.snapshot(snapshot);
  assert.equal(belief.allocationMatchesDeck, true, `belief allocation mismatch ${JSON.stringify(belief.hiddenSlots)}`);
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
    positions: games.reduce((sum, game) => sum + game.samples.length, 0),
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
  const perGame = games.map((game) => {
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
    logLoss: mean(perGame.map((game) => game[stage].logLoss)),
    brier: mean(perGame.map((game) => game[stage].brier)),
    loserProbability: mean(perGame.map((game) => game[stage].loserProbability)),
    topHit: mean(perGame.map((game) => game[stage].topHit)),
  }]));
}

function calibrationReport(games, config) {
  const bins = Array.from({ length: 10 }, (_, index) => ({ from: index * 10, to: (index + 1) * 10, predicted: [], actual: [] }));
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

function loserCounts(games) {
  return Object.fromEntries(PLAYER_NAMES.map((name) => [name, games.filter((game) => game.loser === name).length]));
}

function run() {
  const started = Date.now();
  const completeGames = [];
  const skipped = [];
  for (let seed = 1; seed <= MAX_SEED && completeGames.length < TARGET_GAMES; seed += 1) {
    const game = simulator.runGame(seed, { maxActions: MAX_ACTIONS, sampleEvery: SAMPLE_EVERY });
    if (!game.completed) {
      skipped.push({ seed, actions: game.actions, reason: game.reason });
      continue;
    }
    assert.ok(PLAYER_NAMES.includes(game.loser));
    for (const snapshot of game.samples) assertSnapshotIsPublic(snapshot);
    completeGames.push(game);
  }

  assert.equal(completeGames.length, TARGET_GAMES, `only ${completeGames.length}/${TARGET_GAMES} complete games; skipped=${JSON.stringify(skipped.slice(0, 20))}`);
  const tuningGames = completeGames.slice(0, TUNE_GAMES);
  const holdoutGames = completeGames.slice(TUNE_GAMES);

  const defaultTune = evaluateModel(tuningGames, {});
  const defaultHoldout = evaluateModel(holdoutGames, {});
  const ranked = candidateConfigs()
    .map((config) => ({ config, metrics: evaluateModel(tuningGames, config) }))
    .sort((a, b) => a.metrics.logLoss - b.metrics.logLoss || a.metrics.brier - b.metrics.brier);
  const best = ranked[0];
  const tunedHoldout = evaluateModel(holdoutGames, best.config);
  const report = {
    engine: publicRisk.version,
    simulator: 'pure-node-production-rules-v1',
    targetGames: TARGET_GAMES,
    completedGames: completeGames.length,
    tuningGames: tuningGames.length,
    holdoutGames: holdoutGames.length,
    totalPositions: completeGames.reduce((sum, game) => sum + game.samples.length, 0),
    elapsedMs: Date.now() - started,
    skipped,
    actionStats: {
      min: Math.min(...completeGames.map((game) => game.actions)),
      max: Math.max(...completeGames.map((game) => game.actions)),
      mean: mean(completeGames.map((game) => game.actions)),
    },
    loserCounts: loserCounts(completeGames),
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

  const outputDir = path.join(process.cwd(), 'test-results');
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'shithead-risk-node-backtest.json'), JSON.stringify(report, null, 2));

  assert.ok(Number.isFinite(defaultHoldout.logLoss));
  assert.ok(Number.isFinite(tunedHoldout.logLoss));
  assert.ok(report.totalPositions >= 5000, `expected thousands of positions, got ${report.totalPositions}`);

  console.log(`[risk-node] ${report.completedGames} games / ${report.totalPositions} public positions in ${report.elapsedMs}ms`);
  console.log(`[risk-node] loser counts ${JSON.stringify(report.loserCounts)}`);
  console.log(`[risk-node] equal baseline holdout logLoss=${tunedHoldout.baselineLogLoss.toFixed(4)} brier=${tunedHoldout.baselineBrier.toFixed(4)}`);
  console.log(`[risk-node] default holdout logLoss=${defaultHoldout.logLoss.toFixed(4)} brier=${defaultHoldout.brier.toFixed(4)} topHit=${(defaultHoldout.topHit * 100).toFixed(1)}%`);
  console.log(`[risk-node] tuned holdout logLoss=${tunedHoldout.logLoss.toFixed(4)} brier=${tunedHoldout.brier.toFixed(4)} topHit=${(tunedHoldout.topHit * 100).toFixed(1)}%`);
  console.log(`[risk-node] tuned vs equal: logLoss ${report.holdoutImprovementVsEqualBaseline.tunedLogLossPercent.toFixed(2)}%, brier ${report.holdoutImprovementVsEqualBaseline.tunedBrierPercent.toFixed(2)}%`);
  console.log(`[risk-node] best config ${JSON.stringify(best.config)}`);
  console.log(`[risk-node] REPORT ${JSON.stringify(report)}`);
}

run();
