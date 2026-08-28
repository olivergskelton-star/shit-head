const assert = require('node:assert/strict');
const belief = require('../shithead-belief-state-v1.js');
const publicRisk = require('../shithead-public-risk-v1.js');

function card(rank) { return { rank, suit: 'S' }; }
function table(upRanks = []) {
  return [0, 1, 2].map((i) => ({
    faceUp: upRanks[i] ? card(upRanks[i]) : null,
    faceDown: card(['4', '5', '6'][i]),
  }));
}
function makeState() {
  return {
    phase: 'play', currentPlayer: 'Oliver', followUpRank: null,
    drawPile: Array.from({ length: 28 }, () => card('4')),
    discard: [card('10')], burnPile: [],
    players: {
      Oliver: { hand: [card('A'), card('K'), card('Q')], tableSlots: table(['8', '9', 'J']) },
      Dan: { hand: [card('4'), card('5'), card('6')], tableSlots: table(['7', '8', '9']) },
      Chris: { hand: [card('2'), card('3'), card('10')], tableSlots: table(['Q', 'K', 'A']) },
    },
  };
}

const s = makeState();
assert.equal(belief.remainingRankCounts(s)['10'], 3);

const expectedThree = belief.expectedRankCount(s, 3, '10');
assert.ok(expectedThree > 0 && expectedThree < 3);
assert.equal(expectedThree, belief.playerBeliefs(s).Oliver.hand['10'].expected);
assert.equal(expectedThree, belief.playerBeliefs(s).Dan.hand['10'].expected);
assert.equal(expectedThree, belief.playerBeliefs(s).Chris.hand['10'].expected);

const chanceTwo = belief.probabilityAtLeastOneRank(s, 2, '10');
const chanceEight = belief.probabilityAtLeastOneRank(s, 8, '10');
assert.ok(chanceEight > chanceTwo);

const dist = belief.rankDistributionForHiddenSet(s, 3)['10'].probabilities;
assert.ok(Math.abs(dist.reduce((a, b) => a + b, 0) - 1) < 1e-10);
assert.ok(dist[0] > 0 && dist[1] > 0 && dist[2] > 0 && dist[3] > 0);

const revealed = makeState();
revealed.discard.push(card('10'));
assert.equal(belief.remainingRankCounts(revealed)['10'], 2);
assert.ok(belief.probabilityAtLeastOneRank(revealed, 3, '10') < belief.probabilityAtLeastOneRank(s, 3, '10'));

const hiddenA = makeState();
const hiddenB = makeState();
hiddenA.players.Dan.hand = [card('10'), card('10'), card('2')];
hiddenB.players.Dan.hand = [card('4'), card('5'), card('6')];
hiddenA.players.Chris.hand = [card('10'), card('A'), card('K')];
hiddenB.players.Chris.hand = [card('2'), card('3'), card('4')];
assert.deepEqual(
  publicRisk.calculatePublicShitheadProbability(hiddenA),
  publicRisk.calculatePublicShitheadProbability(hiddenB),
);

const probabilities = publicRisk.calculatePublicShitheadProbability(s);
assert.ok(Math.abs(Object.values(probabilities).reduce((a, b) => a + b, 0) - 100) < 1e-9);

console.log('Belief-state tests passed');
