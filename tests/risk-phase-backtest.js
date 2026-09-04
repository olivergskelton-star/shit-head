'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const simulator = require('./risk-simulator.js');
const publicRisk = require('../shithead-public-risk-v1.js');
const beliefState = require('../shithead-belief-state-v1.js');

const PLAYERS = simulator.PLAYER_NAMES;
const TARGET_GAMES = Number(process.env.SHITHEAD_RISK_GAMES || 300);
const STATIC_TUNE_GAMES = 150;
const PHASE_TUNE_GAMES = 50;
const FINAL_HOLDOUT_GAMES = TARGET_GAMES - STATIC_TUNE_GAMES - PHASE_TUNE_GAMES;
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
  return PLAYERS.filter((name) => Number.isFinite(details[name]?.riskScore) && !details[name]?.guaranteedSafe);
}

function publicPhase(snapshot, details) {
  if ((snapshot.drawPile?.length || 0) > 0) return 'draw';
  const active = activeFromDetails(details).length;
  return active <= 2 ? 'twoPlayer' : 'tableThree';
}

function equalOddsFromDetails(details) {
  const active = activeFromDetails(details);
  const p = active.length ? 100 / active.length : 0;
  return Object.fromEntries(PLAYERS.map((name) => [name, active.includes(name) ? p : 0]));
}

function riskScores(details, config) {
  const cardQualityScale = config.cardQualityWeight / DEFAULTS.cardQualityWeight;
  return Object.fromEntries(activeFromDetails(details).map((name) => {
    const c = details[name].components;
    const value = (c.burden * config.burdenScale)
      + (c.cardQuality * cardQualityScale)
      + c.tableTrap
      + (c.pickupDanger * config.pickupScale)
      - c.comboStrength;
    return [name, value];
  }));
}

function probabilitiesFromFeatures(row, config) {
  const active = activeFromDetails(row.details);
  if (!active.length) return Object.fromEntries(PLAYERS.map((name) => [name, 0]));
  if (active.length === 1) return Object.fromEntries(PLAYERS.map((name) => [name, name === active[0] ? 100 : 0]));

  const scores = riskScores(row.details, config);
  const temperature = config.phaseTemps?.[row.phase] ?? config.temperature;
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
      phase: publicPhase(snapshot, details),
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
      modelRows.push(score(probabilitiesFromFeatures(row, config), game.loser));
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

function staticCandidates() {
  const result = [];
  for (const temperature of [24, 30, 36, 48]) {
    for (const burdenScale of [0.5, 0.625, 0.75]) {
      for (const cardQualityWeight of [0.6, 0.9, 1.2]) {
        for (const pickupScale of [0.4, 0.7, 1]) {
          result.push({ temperature, burdenScale, cardQualityWeight, pickupScale });
        }
      }
    }
  }
  return result;
}

function phaseCandidates(staticConfig) {
  const result = [];
  for (const draw of [36, 48, 60, 72]) {
    for (const tableThree of [24, 30, 36, 48]) {
      for (const twoPlayer of [12, 18, 24, 30]) {
        result.push({ ...staticConfig, phaseTemps: { draw, tableThree, twoPlayer } });
      }
    }
  }
  return result;
}

function phaseReport(games, config) {
  const output = {};
  for (const phase of ['draw', 'tableThree', 'twoPlayer']) {
    const perGame = [];
    let positions = 0;
    for (const game of games) {
      const rows = game.rows.filter((row) => row.phase === phase);
      if (!rows.length) continue;
      positions += rows.length;
      const scored = rows.map((row) => score(probabilitiesFromFeatures(row, config), game.loser));
      const baseline = rows.map((row) => score(row.baseline, game.loser));
      perGame.push({
        logLoss: mean(scored.map((item) => item.logLoss)),
        brier: mean(scored.map((item) => item.brier)),
        loserProbability: mean(scored.map((item) => item.loserProbability)),
        topHit: mean(scored.map((item) => item.topHit)),
        baselineLogLoss: mean(baseline.map((item) => item.logLoss)),
        baselineBrier: mean(baseline.map((item) => item.brier)),
      });
    }
    output[phase] = {
      games: perGame.length,
      positions,
      logLoss: mean(perGame.map((row) => row.logLoss)),
      brier: mean(perGame.map((row) => row.brier)),
      loserProbability: mean(perGame.map((row) => row.loserProbability)),
      topHit: mean(perGame.map((row) => row.topHit)),
      baselineLogLoss: mean(perGame.map((row) => row.baselineLogLoss)),
      baselineBrier: mean(perGame.map((row) => row.baselineBrier)),
    };
  }
  return output;
}

function calibration(games, config) {
  const bins = Array.from({ length: 10 }, (_, i) => ({ from: i * 10, to: (i + 1) * 10, predicted: [], actual: [] }));
  for (const game of games) {
    for (const row of game.rows) {
      const probabilities = probabilitiesFromFeatures(row, config);
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
  assert.ok(FINAL_HOLDOUT_GAMES >= 50, 'need at least 50 untouched final games');
  const started = Date.now();
  const games = [];
  const skipped = [];
  for (let seed = 1; games.length < TARGET_GAMES && seed <= 1500; seed += 1) {
    const raw = simulator.runGame(seed, { maxActions: MAX_ACTIONS, sampleEvery: SAMPLE_EVERY });
    if (!raw.completed) {
      skipped.push({ seed, actions: raw.actions, reason: raw.reason });
      continue;
    }
    games.push(preprocessGame(raw));
  }
  assert.equal(games.length, TARGET_GAMES, `only ${games.length} complete games`);

  const staticTune = games.slice(0, STATIC_TUNE_GAMES);
  const phaseTune = games.slice(STATIC_TUNE_GAMES, STATIC_TUNE_GAMES + PHASE_TUNE_GAMES);
  const finalHoldout = games.slice(STATIC_TUNE_GAMES + PHASE_TUNE_GAMES);

  const defaultConfig = {
    temperature: DEFAULTS.temperature,
    burdenScale: 1,
    cardQualityWeight: DEFAULTS.cardQualityWeight,
    pickupScale: 1,
  };

  const staticRanked = staticCandidates()
    .map((config) => ({ config, metrics: evaluate(staticTune, config) }))
    .sort((a, b) => a.metrics.logLoss - b.metrics.logLoss || a.metrics.brier - b.metrics.brier);
  const bestStatic = staticRanked[0];

  const phaseRanked = phaseCandidates(bestStatic.config)
    .map((config) => ({ config, metrics: evaluate(phaseTune, config) }))
    .sort((a, b) => a.metrics.logLoss - b.metrics.logLoss || a.metrics.brier - b.metrics.brier);
  const bestPhase = phaseRanked[0];

  const defaultFinal = evaluate(finalHoldout, defaultConfig);
  const staticFinal = evaluate(finalHoldout, bestStatic.config);
  const phaseFinal = evaluate(finalHoldout, bestPhase.config);
  const positions = games.reduce((sum, game) => sum + game.rows.length, 0);

  const report = {
    engine: publicRisk.version,
    simulator: 'pure-node-production-rules-v1',
    games: games.length,
    publicPositions: positions,
    elapsedMs: Date.now() - started,
    splits: {
      staticTune: staticTune.length,
      phaseTune: phaseTune.length,
      finalHoldout: finalHoldout.length,
      finalSeedRange: [finalHoldout[0]?.seed || null, finalHoldout.at(-1)?.seed || null],
    },
    skipped,
    losers: Object.fromEntries(PLAYERS.map((name) => [name, games.filter((game) => game.loser === name).length])),
    bestStaticTune: bestStatic,
    bestPhaseTune: bestPhase,
    final: {
      equal: { logLoss: phaseFinal.baselineLogLoss, brier: phaseFinal.baselineBrier },
      default: defaultFinal,
      static: staticFinal,
      phase: phaseFinal,
      phaseVsEqual: {
        logLossPercent: improvement(phaseFinal.baselineLogLoss, phaseFinal.logLoss),
        brierPercent: improvement(phaseFinal.baselineBrier, phaseFinal.brier),
      },
      phaseVsStatic: {
        logLossPercent: improvement(staticFinal.logLoss, phaseFinal.logLoss),
        brierPercent: improvement(staticFinal.brier, phaseFinal.brier),
      },
    },
    finalByPublicPhase: phaseReport(finalHoldout, bestPhase.config),
    finalCalibration: calibration(finalHoldout, bestPhase.config),
    topStaticCandidates: staticRanked.slice(0, 5),
    topPhaseCandidates: phaseRanked.slice(0, 5),
  };

  fs.mkdirSync(path.join(process.cwd(), 'test-results'), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), 'test-results', 'shithead-risk-node-backtest.json'), JSON.stringify(report, null, 2));

  assert.ok(Number.isFinite(phaseFinal.logLoss));
  assert.ok(positions >= 20000, `expected at least 20000 public positions, got ${positions}`);
  console.log(`[risk-phase] ${games.length} games / ${positions} public positions / ${report.elapsedMs}ms`);
  console.log(`[risk-phase] splits ${JSON.stringify(report.splits)}`);
  console.log(`[risk-phase] equal final logLoss=${phaseFinal.baselineLogLoss.toFixed(4)} brier=${phaseFinal.baselineBrier.toFixed(4)}`);
  console.log(`[risk-phase] default final logLoss=${defaultFinal.logLoss.toFixed(4)} brier=${defaultFinal.brier.toFixed(4)}`);
  console.log(`[risk-phase] static final logLoss=${staticFinal.logLoss.toFixed(4)} brier=${staticFinal.brier.toFixed(4)}`);
  console.log(`[risk-phase] phase final logLoss=${phaseFinal.logLoss.toFixed(4)} brier=${phaseFinal.brier.toFixed(4)} topHit=${(phaseFinal.topHit * 100).toFixed(1)}%`);
  console.log(`[risk-phase] phase vs equal logLoss=${report.final.phaseVsEqual.logLossPercent.toFixed(2)}% brier=${report.final.phaseVsEqual.brierPercent.toFixed(2)}%`);
  console.log(`[risk-phase] best static ${JSON.stringify(bestStatic.config)}`);
  console.log(`[risk-phase] best phase ${JSON.stringify(bestPhase.config)}`);
  console.log(`[risk-phase] REPORT ${JSON.stringify(report)}`);
}

run();
