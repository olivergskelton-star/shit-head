'use strict';

const assert = require('node:assert/strict');
const publicRisk = require('../shithead-public-risk-v1.js');

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const CALIBRATION = {
  temperature: 36,
  burden: { hand: 3.75, faceUp: 5.25, faceDown: 7.5 },
  cardQualityWeight: 0.9,
  pickupBase: 3.2,
  pickupLogWeight: 2,
};

function screenshotState(chrisFaceUp = '10', chrisBlindCount = 1, reservedHiddenRanks = null) {
  const deck = RANKS.flatMap((rank) => Array.from({ length: 4 }, (_, index) => ({ rank, suit: String(index) })));
  const take = (rank) => deck.splice(deck.findIndex((card) => card.rank === rank), 1)[0];
  const visible = {
    chris: take(chrisFaceUp),
    oliver: take('K'),
    dan: [take('2'), take('A'), take('3')],
  };

  // Reserve the five/six hidden identities without exposing them to the engine.
  const hiddenRanks = reservedHiddenRanks || ['4', '5', '6', '7', '8', '9'].slice(0, 4 + chrisBlindCount);
  assert.equal(hiddenRanks.length, 4 + chrisBlindCount);
  hiddenRanks.forEach(take);
  const hidden = () => ({ hidden: true });

  return {
    phase: 'play',
    currentPlayer: 'Chris',
    followUpRank: null,
    drawPile: [],
    discard: [],
    burnPile: deck,
    players: {
      Chris: {
        hand: [],
        knownHand: [],
        tableSlots: [
          { faceUp: visible.chris, faceDown: hidden() },
          { faceUp: null, faceDown: chrisBlindCount > 1 ? hidden() : null },
          { faceUp: null, faceDown: null },
        ],
      },
      Oliver: {
        hand: [],
        knownHand: [],
        tableSlots: [
          { faceUp: visible.oliver, faceDown: hidden() },
          { faceUp: null, faceDown: null },
          { faceUp: null, faceDown: null },
        ],
      },
      Dan: {
        hand: [],
        knownHand: [],
        tableSlots: visible.dan.map((faceUp) => ({ faceUp, faceDown: hidden() })),
      },
    },
  };
}

{
  const lowHiddenQuality = screenshotState('K', 1, ['4', '4', '5', '5', '6']);
  const highHiddenQuality = screenshotState('K', 1, ['10', '10', '2', '2', 'A']);
  const lowDetails = publicRisk.calculatePublicRiskDetails(lowHiddenQuality, CALIBRATION);
  const highDetails = publicRisk.calculatePublicRiskDetails(highHiddenQuality, CALIBRATION);

  assert.ok(
    highDetails.Chris.components.cardQuality < lowDetails.Chris.components.cardQuality,
    'publicly seen cards must change the probable quality of the unseen blind cards',
  );

  // Actual hidden identities are not public evidence and must never change the result.
  const hiddenTwo = structuredClone(lowHiddenQuality);
  hiddenTwo.players.Chris.tableSlots[0].faceDown = { rank: '2', suit: 'hidden' };
  const hiddenFour = structuredClone(lowHiddenQuality);
  hiddenFour.players.Chris.tableSlots[0].faceDown = { rank: '4', suit: 'hidden' };
  assert.deepEqual(
    publicRisk.calculatePublicShitheadProbability(hiddenTwo, CALIBRATION),
    publicRisk.calculatePublicShitheadProbability(hiddenFour, CALIBRATION),
    'the engine must not peek at a face-down card identity',
  );
}

{
  const state = screenshotState('10', 1);
  const details = publicRisk.calculatePublicRiskDetails(state, CALIBRATION);
  const probabilities = publicRisk.calculatePublicShitheadProbability(state, CALIBRATION);

  assert.equal(details.Chris.guaranteedSafe, true, '10 -> burn -> last blind on empty pile is a forced exit');
  assert.equal(probabilities.Chris, 0, 'forced exit must have zero Shithead probability');
  assert.ok(Math.abs(Object.values(probabilities).reduce((sum, value) => sum + value, 0) - 100) < 1e-9);
}

{
  const state = screenshotState('K', 1);
  const details = publicRisk.calculatePublicRiskDetails(state, CALIBRATION);
  const probabilities = publicRisk.calculatePublicShitheadProbability(state, CALIBRATION);

  assert.equal(details.Chris.guaranteedSafe, false, 'a non-burning face-up card does not preserve the turn');
  assert.ok(probabilities.Chris > 0, 'the covered blind must still contribute probabilistic risk');
}

{
  const state = screenshotState('10', 2);
  const details = publicRisk.calculatePublicRiskDetails(state, CALIBRATION);
  const probabilities = publicRisk.calculatePublicShitheadProbability(state, CALIBRATION);

  assert.equal(details.Chris.guaranteedSafe, false, 'two blind cards are not a forced exit after the burn');
  assert.ok(probabilities.Chris > 0, 'unseen-card quality must still determine residual risk');
}

console.log('[risk-endgame] forced public exit and probabilistic near-miss cases passed');
