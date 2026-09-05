'use strict';

const assert = require('node:assert/strict');
const belief = require('../shithead-belief-state-v1.js');
const risk = require('../shithead-public-risk-v1.js');

const RANKS = belief.RANKS;
const OPTIONS = { rolloutSamples: 512, maxRolloutActions: 1200 };
const card = (rank) => ({ rank, suit: 'fixture' });
const hidden = () => ({ hidden: true });

const HANDS = {
  Oliver: ['5', '6', '7', '9', 'Q', 'K'],
  Dan: ['J', 'A', '3'],
  Chris: ['4', '5', '7', 'K'],
};
const FACE_UP = {
  Oliver: ['A', '2', 'K'],
  Dan: ['J', 'J', 'K'],
  Chris: ['Q', '2', '3'],
};

function screenshotState(hands = HANDS) {
  const deck = RANKS.flatMap((rank) => Array.from({ length: 4 }, () => card(rank)));
  const take = (rank) => {
    const index = deck.findIndex((item) => item.rank === rank);
    assert.notEqual(index, -1, `fixture over-allocated ${rank}`);
    deck.splice(index, 1);
  };
  Object.values(hands).flat().forEach(take);
  Object.values(FACE_UP).flat().forEach(take);

  const players = Object.fromEntries(Object.keys(hands).map((id) => [id, {
    hand: hands[id].map(card),
    // Oliver's previous three-card pickup is public knowledge to every viewer.
    knownHand: id === 'Oliver' ? hands.Oliver.slice(0, 3).map(card) : [],
    tableSlots: FACE_UP[id].map((rank) => ({ faceUp: card(rank), faceDown: hidden() })),
  }]));
  const state = {
    phase: 'play',
    currentPlayer: 'Oliver',
    followUpRank: null,
    drawPile: Array.from({ length: 6 }, hidden),
    discard: [],
    burnPile: deck.slice(0, 15),
    players,
  };
  assert.equal(belief.snapshot(state).allocationMatchesDeck, true);
  return state;
}

function probabilities(state, viewerId) {
  const result = risk.calculatePublicShitheadProbability(state, { ...OPTIONS, viewerId });
  assert.ok(Math.abs(Object.values(result).reduce((sum, value) => sum + value, 0) - 100) < 1e-9);
  return result;
}

{
  const state = screenshotState();
  const oliverView = probabilities(state, 'Oliver');
  const danView = probabilities(state, 'Dan');
  const chrisView = probabilities(state, 'Chris');

  assert.ok(oliverView.Oliver > oliverView.Dan && oliverView.Oliver > oliverView.Chris,
    `Oliver's six-card hand and twelve-card burden should make him highest risk in his view: ${JSON.stringify(oliverView)}`);
  assert.ok(danView.Dan < danView.Oliver,
    `Dan's known three-card hand should make him safer than Oliver: ${JSON.stringify(danView)}`);
  assert.ok(chrisView.Dan < chrisView.Oliver,
    `Dan's smaller public burden should remain safer than Oliver from Chris's view: ${JSON.stringify(chrisView)}`);
  assert.notDeepEqual(oliverView, danView, 'different private hand evidence should produce viewer-specific estimates');

  console.log('[risk-viewer] screenshot position', JSON.stringify({ oliverView, danView, chrisView }));
}

{
  const state = screenshotState();
  const changedOpponentSecrets = structuredClone(state);
  [changedOpponentSecrets.players.Dan.hand[0], changedOpponentSecrets.players.Chris.hand[0]]
    = [changedOpponentSecrets.players.Chris.hand[0], changedOpponentSecrets.players.Dan.hand[0]];
  assert.deepEqual(
    probabilities(state, 'Oliver'),
    probabilities(changedOpponentSecrets, 'Oliver'),
    'Oliver calculation must not inspect Dan or Chris hidden hand identities',
  );
}

{
  const state = screenshotState();
  const changedViewerHand = structuredClone(state);
  [changedViewerHand.players.Oliver.hand[3], changedViewerHand.players.Dan.hand[0]]
    = [changedViewerHand.players.Dan.hand[0], changedViewerHand.players.Oliver.hand[3]];
  assert.notDeepEqual(
    probabilities(state, 'Oliver'),
    probabilities(changedViewerHand, 'Oliver'),
    'Oliver calculation must use cards visible in Oliver hand',
  );
}

console.log('[risk-viewer] viewer evidence, card burden and opponent privacy regressions passed');
