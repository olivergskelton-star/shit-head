'use strict';

const assert = require('node:assert/strict');
const belief = require('../shithead-belief-state-v1.js');
const publicRisk = require('../shithead-public-risk-v1.js');

const RANKS = belief.RANKS;
const OPTIONS = { rolloutSamples: 512, maxRolloutActions: 2500 };
const card = (rank) => ({ rank, suit: 'public' });
const hidden = () => ({ hidden: true });

function slots(faceUps = [], blindCount = 0) {
  return [0, 1, 2].map((index) => ({
    faceUp: faceUps[index] ? card(faceUps[index]) : null,
    faceDown: index < blindCount ? hidden() : null,
  }));
}

function player(handCount, knownRanks, faceUps, blindCount) {
  return {
    hand: Array.from({ length: handCount }, hidden),
    knownHand: knownRanks.map(card),
    tableSlots: slots(faceUps, blindCount),
  };
}

function fillPublicBurn(state, reservedHiddenRanks) {
  const deck = RANKS.flatMap((rank) => Array.from({ length: 4 }, () => card(rank)));
  const take = (rank) => {
    const index = deck.findIndex((item) => item.rank === rank);
    assert.notEqual(index, -1, `fixture over-allocated ${rank}`);
    deck.splice(index, 1);
  };
  state.discard.forEach((item) => take(item.rank));
  Object.values(state.players).forEach((item) => {
    item.knownHand.forEach((known) => take(known.rank));
    item.tableSlots.forEach((slot) => { if (slot.faceUp) take(slot.faceUp.rank); });
  });
  reservedHiddenRanks.forEach(take);
  state.burnPile = deck;
  assert.equal(belief.snapshot(state).allocationMatchesDeck, true, 'fixture must allocate all 52 cards');
  return state;
}

function comparisonState() {
  const state = {
    phase: 'play',
    currentPlayer: 'Chris',
    followUpRank: null,
    drawPile: [],
    discard: [card('9')],
    burnPile: [],
    players: {
      Oliver: player(5, ['6', '6', '9', 'J', 'Q'], ['A', 'K'], 3),
      Dan: player(2, ['4', '7'], ['8', 'Q'], 2),
      Chris: player(0, [], ['10', 'K'], 3),
    },
  };
  return fillPublicBurn(state, ['2', '3', '4', '5', '7', '8', '9', '10']);
}

function acePosition(afterPlay) {
  const state = {
    phase: 'play',
    currentPlayer: afterPlay ? 'Dan' : 'Oliver',
    followUpRank: null,
    drawPile: [],
    discard: afterPlay ? [card('A'), card('A')] : [],
    burnPile: [],
    players: {
      Oliver: player(afterPlay ? 0 : 2, afterPlay ? [] : ['A', 'A'], ['10'], 3),
      Dan: player(7, [], ['J', 'K', '10'], 3),
      Chris: player(4, ['Q', 'K', 'K', 'A'], ['K'], 1),
    },
  };
  return fillPublicBurn(state, ['2', '2', '3', '3', '4', '4', '5', '5', '6', '6', '7', '8', '9', 'J']);
}

{
  const state = comparisonState();
  const probabilities = publicRisk.calculatePublicShitheadProbability(state, OPTIONS);
  assert.ok(
    probabilities.Chris < probabilities.Oliver,
    `five-card Chris with a visible 10 should be safer than ten-card Oliver; got ${JSON.stringify(probabilities)}`,
  );
  assert.ok(
    probabilities.Oliver - probabilities.Chris >= 5,
    `the material position difference should not round to an equal percentage; got ${JSON.stringify(probabilities)}`,
  );
  console.log('[risk-rollout] card-count comparison', JSON.stringify(probabilities));
}

{
  const before = acePosition(false);
  const after = acePosition(true);
  const beforeProbabilities = publicRisk.calculatePublicShitheadProbability(before, OPTIONS);
  const afterProbabilities = publicRisk.calculatePublicShitheadProbability(after, OPTIONS);
  assert.ok(
    afterProbabilities.Oliver <= beforeProbabilities.Oliver,
    `legally shedding the final two hand cards must not increase Oliver's risk; before=${JSON.stringify(beforeProbabilities)} after=${JSON.stringify(afterProbabilities)}`,
  );
  console.log('[risk-rollout] Aces before/after', JSON.stringify({ before: beforeProbabilities, after: afterProbabilities }));
}

{
  const state = comparisonState();
  const changedSecrets = structuredClone(state);
  changedSecrets.players.Chris.tableSlots[1].faceDown = card('A');
  changedSecrets.players.Oliver.hand[2] = card('2');
  assert.deepEqual(
    publicRisk.calculatePublicShitheadProbability(state, OPTIONS),
    publicRisk.calculatePublicShitheadProbability(changedSecrets, OPTIONS),
    'changing actual hidden identities must not change public rollout probabilities',
  );
}

console.log('[risk-rollout] reported card-count, post-Aces and hidden-information regressions passed');
