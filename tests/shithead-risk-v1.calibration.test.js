const assert = require('node:assert/strict');
const risk = require('../shithead-risk-v1.js');

const PUBLIC_VIEWER = '__PUBLIC__';

function c(rank, suit = '♠') { return { rank, suit }; }

function slots(faceUps = [], faceDownMask = [true, true, true]) {
  return [0, 1, 2].map((i) => ({
    faceUp: faceUps[i] || null,
    faceDown: faceDownMask[i] ? c(['4', '5', '6'][i], '♦') : null,
  }));
}

function player(hand = [], faceUps = [], faceDownMask = [true, true, true]) {
  return {
    hand: hand.map((rank) => typeof rank === 'string' ? c(rank) : rank),
    tableSlots: slots(faceUps.map((rank) => typeof rank === 'string' ? c(rank) : rank), faceDownMask),
  };
}

function emptyPlayer() {
  return { hand: [], tableSlots: slots([], [false, false, false]) };
}

function game(players, {
  viewer = 'Oliver',
  currentPlayer = 'Oliver',
  discard = ['9'],
  drawCount = 0,
  phase = 'play',
  shitHead = null,
} = {}) {
  return {
    viewer,
    phase,
    shitHead,
    currentPlayer,
    drawPile: Array.from({ length: drawCount }, () => c('4')),
    discard: discard.map((rank) => typeof rank === 'string' ? c(rank) : rank),
    burnPile: [],
    followUpRank: null,
    players,
  };
}

function score(state, id = 'Oliver', viewer = 'Oliver') {
  return risk.calculateRiskDetails(state, viewer)[id].riskScore;
}

function component(state, componentName, id = 'Oliver', viewer = 'Oliver') {
  return risk.calculateRiskDetails(state, viewer)[id].components[componentName];
}

function probabilities(state, viewer = 'Oliver') {
  return risk.calculateShitheadProbability(state, viewer);
}

function approx(a, b, epsilon = 1e-9) {
  return Math.abs(a - b) <= epsilon;
}

// 1. A large pickup hand must be materially worse than the same position with
// only four cards. Card burden should remain the strongest simple signal.
{
  const common = {
    Dan: player(['9'], [], [false, false, false]),
    Chris: player(['9'], [], [false, false, false]),
  };
  const huge = game({
    Oliver: player(['4', '4', '4', '4', '4', '4', '4', '4', '4', '4', '4', '4', '4'], ['Q', 'K', 'A']),
    ...common,
  });
  const small = game({
    Oliver: player(['4', '4', '4', '4'], ['Q', 'K', 'A']),
    ...common,
  });
  assert.ok(score(huge) > score(small) + 40, '13-card pickup hand should be much riskier than four cards');
}

// 2. Card quality matters: six excellent escape cards can be safer than four
// awkward low cards even though the good hand is larger.
{
  const good = game({
    Oliver: player(['10', '10', '2', '3', 'A', 'K'], ['A', 'Q', '10']),
    Dan: player(['9'], [], [false, false, false]),
    Chris: player(['9'], [], [false, false, false]),
  });
  const bad = game({
    Oliver: player(['4', '4', '5', '6'], ['A', 'Q', '10']),
    Dan: player(['9'], [], [false, false, false]),
    Chris: player(['9'], [], [false, false, false]),
  });
  assert.ok(score(good) < score(bad), 'strong specials should offset some extra card burden');
}

// 3. A triple is an escape route, not merely three separate cards.
{
  const triple = game({
    Oliver: player(['Q', 'Q', 'Q'], ['9', 'J', 'K']),
    Dan: player(['9'], [], [false, false, false]),
    Chris: player(['9'], [], [false, false, false]),
  });
  const singles = game({
    Oliver: player(['Q', 'K', 'J'], ['9', 'J', 'K']),
    Dan: player(['9'], [], [false, false, false]),
    Chris: player(['9'], [], [false, false, false]),
  });
  assert.ok(score(triple) < score(singles), 'three matching cards should reduce risk');
  assert.ok(component(triple, 'comboStrength') > component(singles, 'comboStrength'));
}

// 4. House rule: if the final hand is KK and a visible table K remains, all
// three can leave together. That concrete route should improve the position.
{
  const matched = game({
    Oliver: player(['K', 'K'], ['8', '9', 'K']),
    Dan: player(['9'], [], [false, false, false]),
    Chris: player(['9'], [], [false, false, false]),
  });
  const unmatched = game({
    Oliver: player(['K', 'K'], ['8', '9', 'Q']),
    Dan: player(['9'], [], [false, false, false]),
    Chris: player(['9'], [], [false, false, false]),
  });
  assert.ok(score(matched) < score(unmatched), 'matching final hand + table card should be safer');
}

// 5. Completing the three-8 burn is a major immediate escape opportunity.
{
  const burnReady = game({
    Oliver: player(['8', '5', '6'], ['Q', 'K', 'A']),
    Dan: player(['9'], [], [false, false, false]),
    Chris: player(['9'], [], [false, false, false]),
  }, { discard: ['8', '8'] });
  const ordinaryPile = game({
    Oliver: player(['8', '5', '6'], ['Q', 'K', 'A']),
    Dan: player(['9'], [], [false, false, false]),
    Chris: player(['9'], [], [false, false, false]),
  }, { discard: ['9', '9'] });
  assert.ok(score(burnReady) + 10 < score(ordinaryPile), 'available 8 burn should materially reduce risk');
}

// 6. Three exposed blind cards are intrinsically more dangerous than the same
// three blind cards while still protected beneath excellent visible cards.
{
  const exposed = game({
    Oliver: {
      hand: [],
      tableSlots: [
        { faceUp: null, faceDown: c('4') },
        { faceUp: null, faceDown: c('5') },
        { faceUp: null, faceDown: c('6') },
      ],
    },
    Dan: player(['9'], [], [false, false, false]),
    Chris: player(['9'], [], [false, false, false]),
  });
  const covered = game({
    Oliver: player([], ['10', 'A', 'K']),
    Dan: player(['9'], [], [false, false, false]),
    Chris: player(['9'], [], [false, false, false]),
  });
  assert.ok(component(exposed, 'tableTrap') > component(covered, 'tableTrap'), 'exposed blinds should carry the larger uncertainty penalty');
}

// 7. Visible low table cards are a trap compared with strong/power cards.
{
  const low = game({
    Oliver: player([], ['4', '5', '6']),
    Dan: player(['9'], [], [false, false, false]),
    Chris: player(['9'], [], [false, false, false]),
  });
  const high = game({
    Oliver: player([], ['10', 'A', 'K']),
    Dan: player(['9'], [], [false, false, false]),
    Chris: player(['9'], [], [false, false, false]),
  });
  assert.ok(score(low) > score(high) + 20, '4/5/6 table should be much worse than 10/A/K');
}

// 8. Immediate pickup danger must matter most on the current turn.
{
  const trappedNow = game({
    Oliver: player(['4', '5', '6'], ['Q', 'K', 'A']),
    Dan: player(['10', 'A', 'K'], ['Q', 'K', 'A']),
    Chris: player(['10', '2', 'A'], ['Q', 'K', 'A']),
  }, { currentPlayer: 'Oliver', discard: ['A', 'K', 'Q', 'J', 'A', 'K', 'Q', 'A', 'K', 'A'] });
  const trappedLater = JSON.parse(JSON.stringify(trappedNow));
  trappedLater.currentPlayer = 'Dan';
  assert.ok(component(trappedNow, 'pickupDanger') > component(trappedLater, 'pickupDanger') * 2, 'current-turn pickup risk should dominate future-turn speculation');
}

// 9. Pickup severity grows with pile size, but deliberately not linearly.
{
  function trapped(pileSize) {
    return game({
      Oliver: player(['4', '5', '6'], ['Q', 'K', 'A']),
      Dan: player(['9'], [], [false, false, false]),
      Chris: player(['9'], [], [false, false, false]),
    }, { discard: Array.from({ length: pileSize }, () => 'A') });
  }
  const five = component(trapped(5), 'pickupDanger');
  const twenty = component(trapped(20), 'pickupDanger');
  assert.ok(twenty > five, 'larger pile should be worse');
  assert.ok(twenty < five * 2, '20 cards should not be four times as catastrophic as five');
}

// 10. A 10 is a clean escape from an otherwise forced pickup.
{
  const trapped = game({
    Oliver: player(['4', '5', '6'], ['Q', 'K', 'A']),
    Dan: player(['9'], [], [false, false, false]),
    Chris: player(['9'], [], [false, false, false]),
  }, { discard: Array.from({ length: 20 }, () => 'A') });
  const escaped = JSON.parse(JSON.stringify(trapped));
  escaped.players.Oliver.hand = [c('10'), c('5'), c('6')];
  assert.ok(component(trapped, 'pickupDanger') > 0);
  assert.equal(component(escaped, 'pickupDanger'), 0);
}

// 11. The 7 house rule is modelled correctly: ordinary high cards cannot answer
// a 7, while 4/5/6 can.
{
  const low = game({
    Oliver: player(['4', '5', '6'], ['Q', 'K', 'A']),
    Dan: player(['9'], [], [false, false, false]),
    Chris: player(['9'], [], [false, false, false]),
  }, { discard: ['7'] });
  const high = JSON.parse(JSON.stringify(low));
  high.players.Oliver.hand = [c('K'), c('A'), c('Q')];
  assert.equal(component(low, 'pickupDanger'), 0);
  assert.ok(component(high, 'pickupDanger') > 0);
}

// 12. A transparent 3 does not change the live rank underneath it.
{
  const state = game({
    Oliver: player(['Q', '3', '10'], ['Q', 'K', 'A']),
    Dan: player(['9'], [], [false, false, false]),
    Chris: player(['9'], [], [false, false, false]),
  }, { discard: ['K', '3'] });
  assert.equal(risk.canPlayRank('Q', state), false, 'Q should still be blocked by the K under the 3');
  assert.equal(risk.canPlayRank('3', state), true);
  assert.equal(risk.canPlayRank('10', state), true);
}

// 13. The classic supplied calibration scenario: a player stranded on three
// exposed blinds with a substantial pile should rank as the most vulnerable.
{
  const state = game({
    Oliver: player(['10', '2'], ['A', 'K', 'Q']),
    Dan: {
      hand: [],
      tableSlots: [
        { faceUp: null, faceDown: c('4') },
        { faceUp: null, faceDown: c('5') },
        { faceUp: null, faceDown: c('6') },
      ],
    },
    Chris: player(['10', 'A'], ['10', 'K', 'Q']),
  }, {
    currentPlayer: 'Dan',
    discard: ['9', 'Q', 'K', 'A', '9', 'K', 'A', '9'],
  });
  const p = probabilities(state, 'Oliver');
  assert.ok(p.Dan > p.Oliver && p.Dan > p.Chris, JSON.stringify(p));
}

// 14. OUT players are not candidates to become Shit Head.
{
  const state = game({
    Oliver: emptyPlayer(),
    Dan: player(['4', '5'], ['9']),
    Chris: player(['10'], ['A']),
  }, { currentPlayer: 'Dan', discard: ['K'] });
  const p = probabilities(state, 'Oliver');
  assert.equal(p.Oliver, 0);
  assert.ok(approx(p.Dan + p.Chris, 100));
}

// 15. Once the round is over, the actual Shit Head is 100% by definition.
{
  const state = game({
    Oliver: emptyPlayer(),
    Dan: player(['4'], [], [false, false, false]),
    Chris: emptyPlayer(),
  }, { phase: 'gameover', shitHead: 'Dan', currentPlayer: 'Dan' });
  const p = probabilities(state, 'Oliver');
  assert.deepEqual(p, { Oliver: 0, Dan: 100, Chris: 0 });
}

// 16. Privacy regression: from Oliver's perspective, replacing Dan's hidden hand
// with completely different identities must not alter the displayed estimates.
{
  const a = game({
    Oliver: player(['10', 'K'], ['A', 'Q', '7']),
    Dan: player(['10', '10', '2', 'A'], ['8', '9', 'J']),
    Chris: player(['Q', 'Q', '2'], ['K', 'A', '10']),
  }, { drawCount: 2 });
  const b = JSON.parse(JSON.stringify(a));
  b.players.Dan.hand = [c('4'), c('4'), c('5'), c('6')];
  assert.deepEqual(probabilities(a, 'Oliver'), probabilities(b, 'Oliver'));
}

// 17. A fully public estimate can be obtained with a sentinel viewer that owns no
// private hand. It must remain identical regardless of each browser's local View As.
{
  const a = game({
    Oliver: player(['10', 'K'], ['A', 'Q', '7']),
    Dan: player(['4', '5', '6'], ['8', '9', 'J']),
    Chris: player(['Q', 'Q', '2'], ['K', 'A', '10']),
  }, { viewer: 'Oliver', drawCount: 2 });
  const b = JSON.parse(JSON.stringify(a));
  b.viewer = 'Dan';
  assert.deepEqual(probabilities(a, PUBLIC_VIEWER), probabilities(b, PUBLIC_VIEWER));
}

// 18. Public estimates must also ignore all hidden opponent hand identities.
{
  const a = game({
    Oliver: player(['10', 'K'], ['A', 'Q', '7']),
    Dan: player(['10', '10', '2', 'A'], ['8', '9', 'J']),
    Chris: player(['Q', 'Q', '2'], ['K', 'A', '10']),
  });
  const b = JSON.parse(JSON.stringify(a));
  b.players.Dan.hand = [c('4'), c('4'), c('5'), c('6')];
  b.players.Chris.hand = [c('10'), c('10'), c('10')];
  assert.deepEqual(probabilities(a, PUBLIC_VIEWER), probabilities(b, PUBLIC_VIEWER));
}

// 19. Multiple exposed blind choices do not pretend to reveal their identities.
// Pickup probability is based on one unknown blind draw, not secret knowledge.
{
  const oneBlind = game({
    Oliver: {
      hand: [],
      tableSlots: [
        { faceUp: null, faceDown: c('4') },
        { faceUp: null, faceDown: null },
        { faceUp: null, faceDown: null },
      ],
    },
    Dan: player(['9'], [], [false, false, false]),
    Chris: player(['9'], [], [false, false, false]),
  }, { discard: ['A'] });
  const threeBlinds = JSON.parse(JSON.stringify(oneBlind));
  threeBlinds.players.Oliver.tableSlots[1].faceDown = c('5');
  threeBlinds.players.Oliver.tableSlots[2].faceDown = c('6');
  assert.ok(approx(component(oneBlind, 'pickupDanger'), component(threeBlinds, 'pickupDanger')));
}

// 20. Every active three-player calibration output must normalise to 100%.
{
  const state = game({
    Oliver: player(['10', 'K'], ['A', 'Q', '7']),
    Dan: player(['4', '5', '6'], ['8', '9', 'J']),
    Chris: player(['Q', 'Q', '2'], ['K', 'A', '10']),
  }, { drawCount: 2 });
  const p = probabilities(state, PUBLIC_VIEWER);
  const total = Object.values(p).reduce((sum, value) => sum + value, 0);
  assert.ok(approx(total, 100), `public probabilities sum to ${total}`);
}

console.log('Shithead Risk v1 calibration suite passed (20 scenarios)');
