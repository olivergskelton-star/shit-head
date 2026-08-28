const assert = require('node:assert/strict');
const risk = require('../shithead-risk-v1.js');

function c(rank, suit = '♠') { return { rank, suit }; }
function slots(faceUps = [], faceDownMask = [true, true, true]) {
  return [0, 1, 2].map((i) => ({
    faceUp: faceUps[i] || null,
    faceDown: faceDownMask[i] ? c(['4', '5', '6'][i], '♦') : null,
  }));
}
function baseState() {
  return {
    viewer: 'Oliver',
    phase: 'play',
    currentPlayer: 'Oliver',
    drawPile: [c('4'), c('5')],
    discard: [c('9', '♥')],
    burnPile: [],
    followUpRank: null,
    players: {
      Oliver: { hand: [c('10'), c('K')], tableSlots: slots([c('A'), c('Q'), c('7')]) },
      Dan: { hand: [c('4'), c('5'), c('6')], tableSlots: slots([c('8'), c('9'), c('J')]) },
      Chris: { hand: [c('Q'), c('Q'), c('2')], tableSlots: slots([c('K'), c('A'), c('10')]) },
    },
  };
}

{
  const state = baseState();
  const p = risk.calculateShitheadProbability(state, 'Oliver');
  const sum = Object.values(p).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 100) < 1e-9, `probabilities sum to ${sum}`);
}

{
  const state = baseState();
  state.players.Chris = { hand: [], tableSlots: slots([], [false, false, false]) };
  const p = risk.calculateShitheadProbability(state, 'Oliver');
  assert.equal(p.Chris, 0);
}

{
  const a = baseState();
  const b = baseState();
  // Same opponent hand count, wildly different hidden identities. Oliver's public
  // model must not change because Dan's hidden cards are not Oliver's information.
  a.players.Dan.hand = [c('10'), c('10'), c('2'), c('A')];
  b.players.Dan.hand = [c('4'), c('4'), c('5'), c('6')];
  const pa = risk.calculateShitheadProbability(a, 'Oliver');
  const pb = risk.calculateShitheadProbability(b, 'Oliver');
  assert.deepEqual(pa, pb);
}

{
  const state = baseState();
  state.drawPile = [];
  state.discard = [c('9'), c('Q'), c('K'), c('A'), c('9'), c('K'), c('A'), c('9')];
  state.currentPlayer = 'Dan';
  state.players.Oliver = { hand: [c('10'), c('2')], tableSlots: slots([c('A'), c('K'), c('Q')]) };
  state.players.Chris = { hand: [c('10'), c('A')], tableSlots: slots([c('10'), c('K'), c('Q')]) };
  state.players.Dan = {
    hand: [],
    tableSlots: [
      { faceUp: null, faceDown: c('4') },
      { faceUp: null, faceDown: c('5') },
      { faceUp: null, faceDown: c('6') },
    ],
  };
  const p = risk.calculateShitheadProbability(state, 'Oliver');
  assert.ok(p.Dan > p.Oliver && p.Dan > p.Chris, JSON.stringify(p));
}

{
  const stateA = baseState();
  stateA.drawPile = [];
  stateA.players.Oliver.hand = [c('K'), c('K')];
  stateA.players.Oliver.tableSlots = [
    { faceUp: c('8'), faceDown: c('4') },
    { faceUp: c('9'), faceDown: c('5') },
    { faceUp: c('K'), faceDown: c('6') },
  ];
  const stateB = JSON.parse(JSON.stringify(stateA));
  stateB.players.Oliver.hand = [c('K'), c('Q')];
  const a = risk.calculateRiskDetails(stateA, 'Oliver').Oliver;
  const b = risk.calculateRiskDetails(stateB, 'Oliver').Oliver;
  assert.ok(a.riskScore < b.riskScore, `${a.riskScore} !< ${b.riskScore}`);
}

{
  const trapped = baseState();
  trapped.currentPlayer = 'Oliver';
  trapped.discard = [c('A'), c('K'), c('Q'), c('J'), c('A')];
  trapped.players.Oliver.hand = [c('4'), c('5'), c('6')];
  const escaped = JSON.parse(JSON.stringify(trapped));
  escaped.players.Oliver.hand = [c('10'), c('5'), c('6')];
  const a = risk.calculateRiskDetails(trapped, 'Oliver').Oliver.components.pickupDanger;
  const b = risk.calculateRiskDetails(escaped, 'Oliver').Oliver.components.pickupDanger;
  assert.ok(a > b, `${a} !> ${b}`);
}

console.log('Shithead Risk v1 tests passed');