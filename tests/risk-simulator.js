'use strict';

const PLAYER_NAMES = ['Oliver', 'Dan', 'Chris'];
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const NORMAL_ORDER = ['4', '5', '6', '7', '8', '9', 'J', 'Q', 'K', 'A'];
const STARTING_RANK_ORDER = ['4', '5', '6', '7', '8', '9', 'J', 'Q', 'K', '10'];

function makeRng(seed) {
  let state = (Number(seed) || 1) >>> 0;
  return function random() {
    state += 0x6D2B79F5;
    let r = state;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function buildDeck() {
  return SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit })));
}

function shuffle(cards, random) {
  const copy = [...cards];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function cardId(card) {
  return card ? `${card.rank}|${card.suit}` : null;
}

function publicCard(card) {
  return card ? { rank: card.rank, suit: card.suit } : null;
}

function hiddenCard() {
  return { hidden: true };
}

function normalRankValue(rank) {
  return NORMAL_ORDER.indexOf(rank);
}

function effectiveTop(state) {
  for (let i = state.discard.length - 1; i >= 0; i -= 1) {
    if (state.discard[i].rank !== '3') return state.discard[i];
  }
  return null;
}

function canPlayRank(state, rank) {
  if (state.followUpRank && rank !== state.followUpRank) return false;
  if (rank === '2' || rank === '3' || rank === '10') return true;
  const target = effectiveTop(state);
  if (!target || target.rank === '2') return true;
  if (target.rank === '7') {
    const candidate = normalRankValue(rank);
    return candidate !== -1 && candidate <= normalRankValue('7');
  }
  const candidate = normalRankValue(rank);
  const targetValue = normalRankValue(target.rank);
  return candidate !== -1 && targetValue !== -1 && candidate >= targetValue;
}

function consecutiveTopCount(state, rank) {
  let count = 0;
  for (let i = state.discard.length - 1; i >= 0; i -= 1) {
    if (state.discard[i].rank !== rank) break;
    count += 1;
  }
  return count;
}

function shouldClearPile(state, rank) {
  if (rank === '10') return true;
  const count = consecutiveTopCount(state, rank);
  return rank === '8' ? count >= 3 : count >= 4;
}

function playerOut(state, name) {
  const player = state.players[name];
  return player.hand.length === 0 && !player.tableSlots.some((slot) => slot.faceUp || slot.faceDown);
}

function livingPlayers(state) {
  return PLAYER_NAMES.filter((name) => !playerOut(state, name));
}

function concludeIfNeeded(state) {
  const living = livingPlayers(state);
  if (living.length > 1) return false;
  state.phase = 'gameover';
  state.shitHead = living[0] || null;
  state.currentPlayer = state.shitHead;
  state.followUpRank = null;
  return true;
}

function markOut(state, name) {
  if (!playerOut(state, name)) return false;
  if (!state.finishOrder.includes(name)) state.finishOrder.push(name);
  return true;
}

function advanceTurn(state, fromName) {
  if (concludeIfNeeded(state)) return null;
  const fromIndex = Math.max(0, PLAYER_NAMES.indexOf(fromName));
  for (let offset = 1; offset <= PLAYER_NAMES.length; offset += 1) {
    const candidate = PLAYER_NAMES[(fromIndex + offset) % PLAYER_NAMES.length];
    if (!playerOut(state, candidate)) {
      state.currentPlayer = candidate;
      return candidate;
    }
  }
  return null;
}

function refillHand(state, player) {
  while (player.hand.length < 3 && state.drawPile.length > 0) player.hand.push(state.drawPile.pop());
}

function hasFollowUp(state, name, rank) {
  const player = state.players[name];
  if (playerOut(state, name)) return false;
  if (player.hand.some((card) => card.rank === rank)) return true;
  if (state.drawPile.length === 0 && player.hand.length === 0) {
    return player.tableSlots.some((slot) => slot.faceUp?.rank === rank);
  }
  return false;
}

function openingStarter(state) {
  for (const rank of STARTING_RANK_ORDER) {
    const holder = PLAYER_NAMES.find((name) => state.players[name].hand.some((card) => card.rank === rank));
    if (holder) return holder;
  }
  return PLAYER_NAMES[0];
}

function createGame(seed) {
  const random = makeRng(seed);
  const deck = shuffle(buildDeck(), random);
  const players = Object.fromEntries(PLAYER_NAMES.map((name) => [name, {
    hand: [],
    tableSlots: [0, 1, 2].map(() => ({ faceUp: null, faceDown: null })),
    knownHandIds: new Set(),
  }]));

  for (let round = 0; round < 3; round += 1) {
    for (const name of PLAYER_NAMES) players[name].tableSlots[round].faceDown = deck.pop();
  }
  for (let round = 0; round < 3; round += 1) {
    for (const name of PLAYER_NAMES) players[name].tableSlots[round].faceUp = deck.pop();
  }
  for (let round = 0; round < 4; round += 1) {
    for (const name of PLAYER_NAMES) players[name].hand.push(deck.pop());
  }

  const state = {
    phase: 'play',
    currentPlayer: PLAYER_NAMES[0],
    followUpRank: null,
    drawPile: deck,
    discard: [],
    burnPile: [],
    finishOrder: [],
    shitHead: null,
    players,
  };
  state.currentPlayer = openingStarter(state);
  return { state, random: makeRng((Number(seed) ^ 0x9E3779B9) >>> 0) };
}

function removeMissingKnownCards(player) {
  const ids = new Set(player.hand.map(cardId));
  for (const knownId of [...player.knownHandIds]) {
    if (!ids.has(knownId)) player.knownHandIds.delete(knownId);
  }
}

function burnDiscard(state) {
  state.burnPile.push(...state.discard);
  state.discard = [];
}

function validatePlay(state, name, refs) {
  if (state.phase !== 'play' || state.currentPlayer !== name || !Array.isArray(refs) || !refs.length) return false;
  const player = state.players[name];
  const cards = refs.map((ref) => ref.zone === 'hand' ? player.hand[ref.index] : player.tableSlots[ref.index]?.faceUp).filter(Boolean);
  if (cards.length !== refs.length) return false;
  const rank = cards[0].rank;
  if (!cards.every((card) => card.rank === rank) || !canPlayRank(state, rank)) return false;
  if (state.followUpRank && rank !== state.followUpRank) return false;

  const handRefs = refs.filter((ref) => ref.zone === 'hand');
  const faceRefs = refs.filter((ref) => ref.zone === 'faceUp');
  if (player.hand.length > 0 || state.drawPile.length > 0) {
    if (!handRefs.length) return false;
    if (faceRefs.length) {
      if (state.drawPile.length > 0) return false;
      const selectedHand = new Set(handRefs.map((ref) => ref.index));
      if (selectedHand.size !== player.hand.length || !player.hand.every((_, index) => selectedHand.has(index))) return false;
    }
  } else if (handRefs.length) return false;
  return true;
}

function playRefs(state, name, refs) {
  if (!validatePlay(state, name, refs)) return false;
  const player = state.players[name];
  const cards = refs.map((ref) => ref.zone === 'hand' ? player.hand[ref.index] : player.tableSlots[ref.index].faceUp);
  const rank = cards[0].rank;
  const handIndices = refs.filter((ref) => ref.zone === 'hand').map((ref) => ref.index).sort((a, b) => b - a);
  const faceSlots = refs.filter((ref) => ref.zone === 'faceUp').map((ref) => ref.index);
  handIndices.forEach((index) => player.hand.splice(index, 1));
  faceSlots.forEach((index) => { player.tableSlots[index].faceUp = null; });
  removeMissingKnownCards(player);
  state.discard.push(...cards);
  refillHand(state, player);

  const cleared = shouldClearPile(state, rank);
  const becameOut = markOut(state, name);
  if (cleared) {
    burnDiscard(state);
    state.followUpRank = null;
    if (becameOut) advanceTurn(state, name);
    return true;
  }
  if (!becameOut && hasFollowUp(state, name, rank)) {
    state.followUpRank = rank;
  } else {
    state.followUpRank = null;
    advanceTurn(state, name);
  }
  return true;
}

function pickupDiscard(state, name) {
  if (state.phase !== 'play' || state.currentPlayer !== name || state.followUpRank || !state.discard.length) return false;
  const player = state.players[name];
  const picked = [...state.discard];
  player.hand.push(...picked);
  state.discard = [];
  picked.forEach((card) => player.knownHandIds.add(cardId(card)));
  advanceTurn(state, name);
  return true;
}

function finishTurn(state, name) {
  if (state.phase !== 'play' || state.currentPlayer !== name || !state.followUpRank) return false;
  state.followUpRank = null;
  advanceTurn(state, name);
  return true;
}

function canPlayBlind(state, name, slotIndex) {
  const player = state.players[name];
  const slot = player?.tableSlots[slotIndex];
  return !!player && state.phase === 'play' && state.currentPlayer === name
    && state.drawPile.length === 0 && player.hand.length === 0 && !state.followUpRank
    && !!slot?.faceDown && !slot.faceUp;
}

function playBlind(state, name, slotIndex) {
  if (!canPlayBlind(state, name, slotIndex)) return false;
  const player = state.players[name];
  const slot = player.tableSlots[slotIndex];
  const card = slot.faceDown;
  slot.faceDown = null;
  state.followUpRank = null;

  if (!canPlayRank(state, card.rank)) {
    const picked = [...state.discard, card];
    player.hand.push(...picked);
    state.discard = [];
    picked.forEach((item) => player.knownHandIds.add(cardId(item)));
    advanceTurn(state, name);
    return true;
  }

  state.discard.push(card);
  const rank = card.rank;
  const cleared = shouldClearPile(state, rank);
  const becameOut = markOut(state, name);
  if (cleared) {
    burnDiscard(state);
    if (becameOut) advanceTurn(state, name);
    return true;
  }
  if (!becameOut && hasFollowUp(state, name, rank)) state.followUpRank = rank;
  else advanceTurn(state, name);
  return true;
}

function groupRefsByRank(cards, zone) {
  const groups = new Map();
  cards.forEach((card, index) => {
    if (!card) return;
    if (!groups.has(card.rank)) groups.set(card.rank, []);
    groups.get(card.rank).push({ zone, index });
  });
  return groups;
}

function uniqueActions(actions) {
  const seen = new Set();
  return actions.filter((action) => {
    const key = JSON.stringify(action);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function playOptions(state, name, zone, cards) {
  const actions = [];
  for (const refs of groupRefsByRank(cards, zone).values()) {
    if (validatePlay(state, name, refs)) actions.push({ type: 'play', refs });
    if (refs.length > 1 && validatePlay(state, name, [refs[0]])) actions.push({ type: 'play', refs: [refs[0]] });
  }
  return actions;
}

function mixedFinalHandOptions(state, name) {
  const player = state.players[name];
  if (state.drawPile.length > 0 || player.hand.length === 0) return [];
  const rank = player.hand[0]?.rank;
  if (!rank || !player.hand.every((card) => card.rank === rank)) return [];
  const handRefs = player.hand.map((_, index) => ({ zone: 'hand', index }));
  const faceRefs = player.tableSlots
    .map((slot, index) => ({ slot, index }))
    .filter(({ slot }) => slot.faceUp?.rank === rank)
    .map(({ index }) => ({ zone: 'faceUp', index }));
  if (!faceRefs.length) return [];
  const refs = [...handRefs, ...faceRefs];
  return validatePlay(state, name, refs) ? [{ type: 'play', refs }] : [];
}

function positionSignature(state) {
  const parts = [state.currentPlayer, state.followUpRank || '-', String(state.drawPile.length), state.discard.map(cardId).join(',')];
  for (const name of PLAYER_NAMES) {
    const player = state.players[name];
    parts.push(name, player.hand.map(cardId).join(','));
    parts.push(player.tableSlots.map((slot) => `${cardId(slot.faceUp) || '-'}>${cardId(slot.faceDown) || '-'}`).join(','));
  }
  return parts.join('~');
}

function legalActions(state, name, repeatCount = 1) {
  const player = state.players[name];
  let actions = [];
  if (state.followUpRank) {
    const rank = state.followUpRank;
    const handRefs = player.hand.map((card, index) => ({ card, index })).filter(({ card }) => card.rank === rank).map(({ index }) => ({ zone: 'hand', index }));
    const faceRefs = player.tableSlots.map((slot, index) => ({ card: slot.faceUp, index })).filter(({ card }) => card?.rank === rank).map(({ index }) => ({ zone: 'faceUp', index }));
    if (handRefs.length && validatePlay(state, name, handRefs)) actions.push({ type: 'play', refs: handRefs });
    if (handRefs.length > 1 && validatePlay(state, name, [handRefs[0]])) actions.push({ type: 'play', refs: [handRefs[0]] });
    if (faceRefs.length && validatePlay(state, name, faceRefs)) actions.push({ type: 'play', refs: faceRefs });
    actions.push({ type: 'finish' });
  } else if (player.hand.length > 0 || state.drawPile.length > 0) {
    actions.push(...playOptions(state, name, 'hand', player.hand));
    actions.push(...mixedFinalHandOptions(state, name));
  } else {
    actions.push(...playOptions(state, name, 'faceUp', player.tableSlots.map((slot) => slot.faceUp)));
    player.tableSlots.forEach((_, index) => {
      if (canPlayBlind(state, name, index)) actions.push({ type: 'blind', slotIndex: index });
    });
  }
  actions = uniqueActions(actions);
  if (!state.followUpRank && state.discard.length && (!actions.length || repeatCount > 1)) actions.push({ type: 'pickup' });
  return uniqueActions(actions);
}

function dispatch(state, name, action) {
  if (action.type === 'play') return playRefs(state, name, action.refs);
  if (action.type === 'blind') return playBlind(state, name, action.slotIndex);
  if (action.type === 'pickup') return pickupDiscard(state, name);
  if (action.type === 'finish') return finishTurn(state, name);
  return false;
}

function publicSnapshot(state) {
  const players = Object.fromEntries(PLAYER_NAMES.map((name) => {
    const player = state.players[name];
    return [name, {
      hand: Array.from({ length: player.hand.length }, hiddenCard),
      knownHand: player.hand.filter((card) => player.knownHandIds.has(cardId(card))).map(publicCard),
      tableSlots: player.tableSlots.map((slot) => ({
        faceUp: publicCard(slot.faceUp),
        faceDown: slot.faceDown ? hiddenCard() : null,
      })),
    }];
  }));
  return {
    phase: state.phase,
    currentPlayer: state.currentPlayer,
    followUpRank: state.followUpRank || null,
    drawPile: Array.from({ length: state.drawPile.length }, hiddenCard),
    discard: state.discard.map(publicCard),
    burnPile: state.burnPile.map(publicCard),
    finishOrder: [...state.finishOrder],
    shitHead: state.shitHead || null,
    players,
  };
}

function cardConservation(state) {
  const cards = [...state.drawPile, ...state.discard, ...state.burnPile];
  for (const name of PLAYER_NAMES) {
    const player = state.players[name];
    cards.push(...player.hand);
    for (const slot of player.tableSlots) {
      if (slot.faceUp) cards.push(slot.faceUp);
      if (slot.faceDown) cards.push(slot.faceDown);
    }
  }
  const ids = cards.map(cardId);
  return { count: ids.length, unique: new Set(ids).size };
}

function runGame(seed, options = {}) {
  const maxActions = options.maxActions ?? 2500;
  const sampleEvery = Math.max(1, options.sampleEvery ?? 2);
  const { state, random } = createGame(seed);
  const seen = new Map();
  const samples = [];
  let actions = 0;

  while (state.phase === 'play' && actions < maxActions) {
    if (actions % sampleEvery === 0) samples.push(publicSnapshot(state));
    const conservation = cardConservation(state);
    if (conservation.count !== 52 || conservation.unique !== 52) {
      return { completed: false, seed, actions, reason: `card conservation ${JSON.stringify(conservation)}`, samples: [] };
    }
    const signature = positionSignature(state);
    const repeats = (seen.get(signature) || 0) + 1;
    seen.set(signature, repeats);
    const name = state.currentPlayer;
    const actionsAvailable = legalActions(state, name, repeats);
    if (!actionsAvailable.length) return { completed: false, seed, actions, reason: `no legal action for ${name}`, samples: [] };
    const base = Math.floor(random() * actionsAvailable.length) % actionsAvailable.length;
    const action = actionsAvailable[(base + Math.max(0, repeats - 1)) % actionsAvailable.length];
    if (!dispatch(state, name, action)) return { completed: false, seed, actions, reason: `rejected ${name} ${action.type}`, samples: [] };
    actions += 1;
  }

  if (state.phase !== 'gameover' || !state.shitHead) {
    return { completed: false, seed, actions, reason: `no gameover by ${maxActions}`, samples: [] };
  }
  const conservation = cardConservation(state);
  if (conservation.count !== 52 || conservation.unique !== 52) {
    return { completed: false, seed, actions, reason: `final card conservation ${JSON.stringify(conservation)}`, samples: [] };
  }
  return { completed: true, seed, actions, loser: state.shitHead, finishOrder: [...state.finishOrder], samples };
}

module.exports = {
  PLAYER_NAMES,
  RANKS,
  NORMAL_ORDER,
  STARTING_RANK_ORDER,
  makeRng,
  buildDeck,
  canPlayRank,
  createGame,
  publicSnapshot,
  cardConservation,
  runGame,
};
