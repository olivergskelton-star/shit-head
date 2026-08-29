// Shithead Risk v1
// Pure, viewer-aware heuristic engine. It deliberately does NOT inspect an
// opponent's hidden hand identities when producing public risk percentages.
(function initShitheadRiskV1(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ShitHeadRiskV1 = api;
})(typeof window !== 'undefined' ? window : null, function buildRiskApi() {
  const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const NORMAL_ORDER = ['4', '5', '6', '7', '8', '9', 'J', 'Q', 'K', 'A'];
  const BASE_UTILITY = Object.freeze({
    '10': 6,
    '2': 5,
    '3': 4,
    'A': 3.5,
    'K': 3,
    'Q': 2,
    '7': 2,
    '8': 1,
    'J': 1,
    '9': 0,
    '6': -1,
    '5': -2,
    '4': -3,
  });

  const DEFAULTS = Object.freeze({
    temperature: 18,
    burden: Object.freeze({ hand: 5, faceUp: 7, faceDown: 10 }),
    cardQualityWeight: 0.9,
    exposedBlindPenalty: 6,
    coveredBlindPenalty: 3,
    pickupBase: 8,
    pickupLogWeight: 5,
    futureTurnWeights: Object.freeze([1, 0.3, 0.1]),
  });

  function cardRank(card) {
    return card && typeof card.rank === 'string' ? card.rank : null;
  }

  function playerIds(gameState) {
    return Object.keys(gameState?.players || {});
  }

  function tableSlotsFor(player) {
    if (!player) return [];
    if (Array.isArray(player.tableSlots) && player.tableSlots.length) {
      return [0, 1, 2].map((index) => ({
        faceUp: player.tableSlots[index]?.faceUp || null,
        faceDown: player.tableSlots[index]?.faceDown || null,
      }));
    }
    const faceUp = Array.isArray(player.faceUp) ? player.faceUp : [];
    const faceDown = Array.isArray(player.faceDown) ? player.faceDown : [];
    return [0, 1, 2].map((index) => ({
      faceUp: faceUp[index] || null,
      faceDown: faceDown[index] || null,
    }));
  }

  function cardCountsFor(player) {
    const slots = tableSlotsFor(player);
    return {
      hand: Array.isArray(player?.hand) ? player.hand.length : 0,
      faceUp: slots.filter((slot) => !!slot.faceUp).length,
      faceDown: slots.filter((slot) => !!slot.faceDown).length,
      total: (Array.isArray(player?.hand) ? player.hand.length : 0)
        + slots.filter((slot) => !!slot.faceUp).length
        + slots.filter((slot) => !!slot.faceDown).length,
    };
  }

  function isOut(player) {
    return cardCountsFor(player).total === 0;
  }

  function effectiveTop(discard) {
    const cards = Array.isArray(discard) ? discard : [];
    for (let index = cards.length - 1; index >= 0; index -= 1) {
      if (cardRank(cards[index]) !== '3') return cards[index];
    }
    return null;
  }

  function topRun(discard) {
    const cards = Array.isArray(discard) ? discard : [];
    const top = cards[cards.length - 1];
    const rank = cardRank(top);
    if (!rank) return { rank: null, count: 0 };
    let count = 0;
    for (let index = cards.length - 1; index >= 0; index -= 1) {
      if (cardRank(cards[index]) !== rank) break;
      count += 1;
    }
    return { rank, count };
  }

  function normalRankValue(rank) {
    return NORMAL_ORDER.indexOf(rank);
  }

  function canPlayRank(rank, gameState) {
    if (!RANKS.includes(rank)) return false;
    if (gameState?.followUpRank && rank !== gameState.followUpRank) return false;
    if (rank === '2' || rank === '3' || rank === '10') return true;

    const target = effectiveTop(gameState?.discard);
    if (!target) return true;
    if (target.rank === '2') return true;

    if (target.rank === '7') {
      const candidate = normalRankValue(rank);
      return candidate !== -1 && candidate <= normalRankValue('7');
    }

    const candidate = normalRankValue(rank);
    const targetValue = normalRankValue(target.rank);
    return candidate !== -1 && targetValue !== -1 && candidate >= targetValue;
  }

  function contextualUtility(rank, gameState) {
    let utility = BASE_UTILITY[rank] ?? 0;
    const pileSize = Array.isArray(gameState?.discard) ? gameState.discard.length : 0;
    const run = topRun(gameState?.discard);

    if (rank === '10') utility += Math.min(2.5, Math.log1p(pileSize) * 0.8);
    if (rank === '2') utility += Math.min(1.5, Math.log1p(pileSize) * 0.5);
    if (rank === '3' && effectiveTop(gameState?.discard)) utility += 0.5;
    if (rank === '7' && effectiveTop(gameState?.discard)?.rank !== '7') utility += 0.5;
    if (rank === '8' && run.rank === '8') {
      if (run.count >= 2) utility += 5;
      else if (run.count === 1) utility += 2;
    }
    if (run.rank === rank && rank !== '8' && run.count === 3) utility += 4;

    return utility;
  }

  function faceUpTrap(card) {
    const utility = BASE_UTILITY[cardRank(card)] ?? 0;
    return Math.max(0, 2 - utility);
  }

  function addKnownCard(known, card) {
    const rank = cardRank(card);
    if (!rank || !Object.prototype.hasOwnProperty.call(known, rank)) return;
    known[rank] += 1;
  }

  function knownRankCounts(gameState, viewerId) {
    const known = Object.fromEntries(RANKS.map((rank) => [rank, 0]));

    (gameState?.discard || []).forEach((card) => addKnownCard(known, card));
    (gameState?.burnPile || []).forEach((card) => addKnownCard(known, card));

    playerIds(gameState).forEach((id) => {
      tableSlotsFor(gameState.players[id]).forEach((slot) => addKnownCard(known, slot.faceUp));
    });

    // Only the viewer's hand is private information that this browser is allowed
    // to use. Opponent hands and every face-down card remain unknown by contract.
    (gameState?.players?.[viewerId]?.hand || []).forEach((card) => addKnownCard(known, card));

    return known;
  }

  function unknownRankCounts(gameState, viewerId) {
    const known = knownRankCounts(gameState, viewerId);
    return Object.fromEntries(RANKS.map((rank) => [rank, Math.max(0, 4 - known[rank])]));
  }

  function totalUnknown(unknown) {
    return RANKS.reduce((sum, rank) => sum + (unknown[rank] || 0), 0);
  }

  function expectedUnknownUtility(handCount, gameState, viewerId) {
    if (handCount <= 0) return 0;
    const unknown = unknownRankCounts(gameState, viewerId);
    const total = totalUnknown(unknown);
    if (!total) return 0;
    const mean = RANKS.reduce(
      (sum, rank) => sum + (unknown[rank] || 0) * contextualUtility(rank, gameState),
      0,
    ) / total;
    return mean * handCount;
  }

  function combination(n, k) {
    if (k < 0 || k > n) return 0;
    if (k === 0 || k === n) return 1;
    let kk = Math.min(k, n - k);
    let result = 1;
    for (let i = 1; i <= kk; i += 1) {
      result = (result * (n - kk + i)) / i;
    }
    return result;
  }

  function hypergeometricProbability(total, successes, draws, k) {
    if (draws < 0 || total < 0 || successes < 0) return 0;
    if (draws > total || k < 0 || k > successes || draws - k > total - successes) return 0;
    const denominator = combination(total, draws);
    if (!denominator) return 0;
    return (combination(successes, k) * combination(total - successes, draws - k)) / denominator;
  }

  function comboBonusForCount(count) {
    if (count >= 4) return 8;
    if (count === 3) return 5;
    if (count === 2) return 2;
    return 0;
  }

  function exactComboStrength(cards) {
    const counts = Object.fromEntries(RANKS.map((rank) => [rank, 0]));
    (cards || []).forEach((card) => {
      const rank = cardRank(card);
      if (rank) counts[rank] += 1;
    });
    return RANKS.reduce((sum, rank) => sum + comboBonusForCount(counts[rank]), 0);
  }

  function expectedUnknownComboStrength(handCount, gameState, viewerId) {
    if (handCount < 2) return 0;
    const unknown = unknownRankCounts(gameState, viewerId);
    const total = totalUnknown(unknown);
    if (!total) return 0;
    const draws = Math.min(handCount, total);

    return RANKS.reduce((sum, rank) => {
      const available = unknown[rank] || 0;
      let expected = 0;
      for (let k = 2; k <= Math.min(4, available, draws); k += 1) {
        expected += hypergeometricProbability(total, available, draws, k) * comboBonusForCount(k);
      }
      return sum + expected;
    }, 0);
  }

  function comboStrengthForPlayer(id, gameState, viewerId) {
    const player = gameState.players[id];
    const hand = Array.isArray(player?.hand) ? player.hand : [];
    let strength = id === viewerId
      ? exactComboStrength(hand)
      : expectedUnknownComboStrength(hand.length, gameState, viewerId);

    const slots = tableSlotsFor(player);
    const visible = slots.map((slot) => slot.faceUp).filter(Boolean);

    if (hand.length === 0) {
      strength += exactComboStrength(visible);
    } else if (id === viewerId && gameState?.drawPile?.length === 0 && hand.length > 0) {
      // House rule: if the final hand is all one rank, matching face-up table cards
      // can join the same play. Reward that concrete escape route.
      const handRank = cardRank(hand[0]);
      if (handRank && hand.every((card) => cardRank(card) === handRank)) {
        const matchingTable = visible.filter((card) => cardRank(card) === handRank).length;
        if (matchingTable) {
          const combined = hand.length + matchingTable;
          strength += Math.max(0, comboBonusForCount(combined) - comboBonusForCount(hand.length));
        }
      }
    }

    const run = topRun(gameState?.discard);
    if (run.rank) {
      const knownCards = id === viewerId ? hand.concat(visible) : visible;
      const matching = knownCards.filter((card) => cardRank(card) === run.rank).length;
      const burnAt = run.rank === '8' ? 3 : 4;
      if (matching > 0 && run.count + matching >= burnAt) strength += 4;
    }

    return strength;
  }

  function tableTrapForPlayer(player, config) {
    return tableSlotsFor(player).reduce((score, slot) => {
      let next = score;
      if (slot.faceUp) next += faceUpTrap(slot.faceUp);
      if (slot.faceDown) {
        next += slot.faceUp ? config.coveredBlindPenalty : config.exposedBlindPenalty;
      }
      return next;
    }, 0);
  }

  function legalUnknownCount(gameState, viewerId) {
    const unknown = unknownRankCounts(gameState, viewerId);
    return RANKS.reduce(
      (sum, rank) => sum + (canPlayRank(rank, gameState) ? (unknown[rank] || 0) : 0),
      0,
    );
  }

  function probabilityNoLegalUnknown(draws, gameState, viewerId) {
    if (draws <= 0) return 1;
    const unknown = unknownRankCounts(gameState, viewerId);
    const total = totalUnknown(unknown);
    if (!total) return 1;
    const legal = legalUnknownCount(gameState, viewerId);
    const illegal = total - legal;
    const n = Math.min(draws, total);
    if (illegal < n) return 0;

    let probability = 1;
    for (let i = 0; i < n; i += 1) {
      probability *= (illegal - i) / (total - i);
    }
    return probability;
  }

  function visiblePlayableCardExists(player, gameState) {
    return tableSlotsFor(player).some((slot) => slot.faceUp && canPlayRank(slot.faceUp.rank, gameState));
  }

  function exposedBlindCount(player) {
    return tableSlotsFor(player).filter((slot) => slot.faceDown && !slot.faceUp).length;
  }

  function noLegalProbabilityForPlayer(id, gameState, viewerId) {
    const player = gameState.players[id];
    const counts = cardCountsFor(player);
    if (counts.total === 0) return 0;
    if (!Array.isArray(gameState?.discard) || gameState.discard.length === 0) return 0;

    if (counts.hand > 0 || (gameState?.drawPile?.length || 0) > 0) {
      if (id === viewerId) {
        return (player.hand || []).some((card) => canPlayRank(card.rank, gameState)) ? 0 : 1;
      }
      return probabilityNoLegalUnknown(counts.hand, gameState, viewerId);
    }

    if (visiblePlayableCardExists(player, gameState)) return 0;
    const blinds = exposedBlindCount(player);
    if (blinds > 0) {
      // Choosing among multiple blind positions does not reveal their values, so
      // the best public estimate is still one random unseen card.
      return probabilityNoLegalUnknown(1, gameState, viewerId);
    }

    return 1;
  }

  function activeTurnDistance(id, gameState) {
    const ids = playerIds(gameState).filter((playerId) => !isOut(gameState.players[playerId]));
    if (!ids.length) return Infinity;
    const current = gameState?.currentPlayer;
    const currentIndex = ids.indexOf(current);
    const playerIndex = ids.indexOf(id);
    if (currentIndex < 0 || playerIndex < 0) return Infinity;
    return (playerIndex - currentIndex + ids.length) % ids.length;
  }

  function pickupDangerForPlayer(id, gameState, viewerId, config) {
    const pileSize = Array.isArray(gameState?.discard) ? gameState.discard.length : 0;
    if (!pileSize || isOut(gameState.players[id])) return 0;

    const distance = activeTurnDistance(id, gameState);
    const weight = config.futureTurnWeights[distance] ?? 0;
    if (!weight) return 0;

    const noLegal = noLegalProbabilityForPlayer(id, gameState, viewerId);
    const severity = config.pickupBase + config.pickupLogWeight * Math.log1p(pileSize);
    return weight * noLegal * severity;
  }

  function burdenForPlayer(player, config) {
    const counts = cardCountsFor(player);
    return counts.hand * config.burden.hand
      + counts.faceUp * config.burden.faceUp
      + counts.faceDown * config.burden.faceDown;
  }

  function cardQualityRiskForPlayer(id, gameState, viewerId, config) {
    const player = gameState.players[id];
    const hand = Array.isArray(player?.hand) ? player.hand : [];
    const slots = tableSlotsFor(player);
    const faceUp = slots.map((slot) => slot.faceUp).filter(Boolean);

    const handUtility = id === viewerId
      ? hand.reduce((sum, card) => sum + contextualUtility(card.rank, gameState), 0)
      : expectedUnknownUtility(hand.length, gameState, viewerId);
    const faceUpUtility = faceUp.reduce((sum, card) => sum + contextualUtility(card.rank, gameState), 0);

    return -(handUtility + faceUpUtility) * config.cardQualityWeight;
  }

  function mergeConfig(options) {
    const input = options || {};
    return {
      ...DEFAULTS,
      ...input,
      burden: { ...DEFAULTS.burden, ...(input.burden || {}) },
      futureTurnWeights: Array.isArray(input.futureTurnWeights)
        ? input.futureTurnWeights
        : DEFAULTS.futureTurnWeights,
    };
  }

  function calculateRiskDetails(gameState, viewerId, options) {
    const config = mergeConfig(options);
    const ids = playerIds(gameState);
    const resolvedViewer = viewerId || gameState?.viewer || null;

    if (gameState?.phase === 'gameover' && gameState?.shitHead) {
      return Object.fromEntries(ids.map((id) => [id, {
        out: id !== gameState.shitHead,
        riskScore: id === gameState.shitHead ? 100 : -Infinity,
        components: { burden: 0, cardQuality: 0, tableTrap: 0, pickupDanger: 0, comboStrength: 0 },
      }]));
    }

    return Object.fromEntries(ids.map((id) => {
      const player = gameState.players[id];
      if (isOut(player)) {
        return [id, {
          out: true,
          riskScore: -Infinity,
          components: { burden: 0, cardQuality: 0, tableTrap: 0, pickupDanger: 0, comboStrength: 0 },
        }];
      }

      const burden = burdenForPlayer(player, config);
      const cardQuality = cardQualityRiskForPlayer(id, gameState, resolvedViewer, config);
      const tableTrap = tableTrapForPlayer(player, config);
      const pickupDanger = pickupDangerForPlayer(id, gameState, resolvedViewer, config);
      const comboStrength = comboStrengthForPlayer(id, gameState, resolvedViewer);
      const riskScore = burden + cardQuality + tableTrap + pickupDanger - comboStrength;

      return [id, {
        out: false,
        riskScore,
        components: { burden, cardQuality, tableTrap, pickupDanger, comboStrength },
      }];
    }));
  }

  function calculateShitheadProbability(gameState, viewerId, options) {
    const config = mergeConfig(options);
    const details = calculateRiskDetails(gameState, viewerId, config);
    const ids = Object.keys(details);
    const active = ids.filter((id) => Number.isFinite(details[id].riskScore));

    if (!active.length) return Object.fromEntries(ids.map((id) => [id, 0]));
    if (active.length === 1) {
      return Object.fromEntries(ids.map((id) => [id, active[0] === id ? 100 : 0]));
    }

    const mean = active.reduce((sum, id) => sum + details[id].riskScore, 0) / active.length;
    const raw = Object.fromEntries(active.map((id) => [
      id,
      Math.exp((details[id].riskScore - mean) / config.temperature),
    ]));
    const denominator = active.reduce((sum, id) => sum + raw[id], 0) || 1;

    return Object.fromEntries(ids.map((id) => [
      id,
      active.includes(id) ? (raw[id] / denominator) * 100 : 0,
    ]));
  }

  function getRiskStatus(lossPercentage) {
    const value = Number(lossPercentage) || 0;
    if (value > 50) return 'High Risk / Potential Shithead';
    if (value >= 25) return 'Moderate Risk';
    return 'Safe / Low Risk';
  }

  return Object.freeze({
    version: 'v1',
    BASE_UTILITY,
    DEFAULTS,
    canPlayRank,
    calculateRiskDetails,
    calculateShitheadProbability,
    getRiskStatus,
  });
});