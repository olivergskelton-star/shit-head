// Shithead public risk v1.1
//
// Public-table risk uses a belief state over genuinely unseen cards. It NEVER reads
// hidden hand identities, face-down identities or draw-pile identities. Cards that
// everyone has already seen enter a hand remain public knowledge via player.knownHand.
(function initPublicRiskV1(root, factory) {
  const belief = typeof module !== 'undefined' && module.exports
    ? require('./shithead-belief-state-v1.js')
    : root?.ShitHeadBeliefStateV1;
  const baseRisk = typeof module !== 'undefined' && module.exports
    ? require('./shithead-risk-v1.js')
    : root?.ShitHeadRiskV1;
  const api = factory(belief, baseRisk);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ShitHeadPublicRiskV1 = api;
})(typeof window !== 'undefined' ? window : null, function buildPublicRiskApi(belief, baseRisk) {
  if (!belief || !baseRisk) throw new Error('Shithead public risk requires belief-state and base-risk modules.');

  const RANKS = belief.RANKS;
  const BASE_UTILITY = baseRisk.BASE_UTILITY;
  const DEFAULTS = Object.freeze({
    temperature: 18,
    burden: Object.freeze({ hand: 5, faceUp: 7, faceDown: 10 }),
    cardQualityWeight: 0.9,
    blindUtilityWeight: 0.25,
    coveredBlindPenalty: 3,
    exposedBlindPenalty: 6,
    pickupBase: 8,
    pickupLogWeight: 5,
    futureTurnWeights: Object.freeze([1, 0.3, 0.1]),
  });

  function tableSlotsFor(player) {
    if (!player) return [];
    if (Array.isArray(player.tableSlots) && player.tableSlots.length) {
      return [0, 1, 2].map((index) => ({
        faceUp: player.tableSlots[index]?.faceUp || null,
        hasFaceDown: !!player.tableSlots[index]?.faceDown,
      }));
    }
    const ups = Array.isArray(player.faceUp) ? player.faceUp : [];
    const downs = Array.isArray(player.faceDown) ? player.faceDown : [];
    return [0, 1, 2].map((index) => ({
      faceUp: ups[index] || null,
      hasFaceDown: !!downs[index],
    }));
  }

  function knownHandFor(player) {
    return typeof belief.knownHandFor === 'function' ? belief.knownHandFor(player) : [];
  }

  function unknownHandCount(player) {
    if (typeof belief.unknownHandCount === 'function') return belief.unknownHandCount(player);
    const hand = Array.isArray(player?.hand) ? player.hand.length : 0;
    return Math.max(0, hand - knownHandFor(player).length);
  }

  function countsFor(player) {
    const slots = tableSlotsFor(player);
    const hand = Array.isArray(player?.hand) ? player.hand.length : 0;
    const faceUp = slots.filter((slot) => !!slot.faceUp).length;
    const faceDown = slots.filter((slot) => slot.hasFaceDown).length;
    return { hand, faceUp, faceDown, total: hand + faceUp + faceDown };
  }

  function isOut(player) { return countsFor(player).total === 0; }

  function topRun(discard) {
    const cards = Array.isArray(discard) ? discard : [];
    const rank = cards[cards.length - 1]?.rank || null;
    if (!rank) return { rank: null, count: 0 };
    let count = 0;
    for (let i = cards.length - 1; i >= 0; i -= 1) {
      if (cards[i]?.rank !== rank) break;
      count += 1;
    }
    return { rank, count };
  }

  function effectiveTop(discard) {
    const cards = Array.isArray(discard) ? discard : [];
    for (let i = cards.length - 1; i >= 0; i -= 1) {
      if (cards[i]?.rank !== '3') return cards[i];
    }
    return null;
  }

  function contextualUtility(rank, gameState) {
    let utility = BASE_UTILITY[rank] ?? 0;
    const pileSize = Array.isArray(gameState?.discard) ? gameState.discard.length : 0;
    const run = topRun(gameState?.discard);
    if (rank === '10') utility += Math.min(2.5, Math.log1p(pileSize) * 0.8);
    if (rank === '2') utility += Math.min(1.5, Math.log1p(pileSize) * 0.5);
    if (rank === '3' && effectiveTop(gameState?.discard)) utility += 0.5;
    if (rank === '7' && effectiveTop(gameState?.discard)?.rank !== '7') utility += 0.5;
    if (rank === '8' && run.rank === '8') utility += run.count >= 2 ? 5 : 2;
    if (run.rank === rank && rank !== '8' && run.count === 3) utility += 4;
    return utility;
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

  function expectedHiddenUtility(gameState, hiddenCount) {
    return RANKS.reduce(
      (sum, rank) => sum + belief.expectedRankCount(gameState, hiddenCount, rank) * contextualUtility(rank, gameState),
      0,
    );
  }

  function knownHandUtility(player, gameState) {
    return knownHandFor(player).reduce((sum, card) => sum + contextualUtility(card.rank, gameState), 0);
  }

  function expectedHandUtility(player, gameState) {
    return knownHandUtility(player, gameState) + expectedHiddenUtility(gameState, unknownHandCount(player));
  }

  function visibleUtility(player, gameState) {
    return tableSlotsFor(player).reduce(
      (sum, slot) => sum + (slot.faceUp ? contextualUtility(slot.faceUp.rank, gameState) : 0),
      0,
    );
  }

  function faceUpTrap(card) {
    const utility = BASE_UTILITY[card?.rank] ?? 0;
    return Math.max(0, 2 - utility);
  }

  function tableTrap(player, config) {
    return tableSlotsFor(player).reduce((sum, slot) => {
      let risk = sum;
      if (slot.faceUp) risk += faceUpTrap(slot.faceUp);
      if (slot.hasFaceDown) risk += slot.faceUp ? config.coveredBlindPenalty : config.exposedBlindPenalty;
      return risk;
    }, 0);
  }

  function comboBonusForCount(count) {
    if (count >= 4) return 8;
    if (count === 3) return 5;
    if (count === 2) return 2;
    return 0;
  }

  function exactVisibleComboStrength(player) {
    const counts = Object.fromEntries(RANKS.map((rank) => [rank, 0]));
    tableSlotsFor(player).forEach((slot) => {
      if (slot.faceUp?.rank && Object.prototype.hasOwnProperty.call(counts, slot.faceUp.rank)) counts[slot.faceUp.rank] += 1;
    });
    return RANKS.reduce((sum, rank) => sum + comboBonusForCount(counts[rank]), 0);
  }

  function knownHandRankCounts(player) {
    const counts = Object.fromEntries(RANKS.map((rank) => [rank, 0]));
    knownHandFor(player).forEach((card) => {
      if (Object.prototype.hasOwnProperty.call(counts, card.rank)) counts[card.rank] += 1;
    });
    return counts;
  }

  function expectedHandComboStrength(player, gameState) {
    const handCount = Array.isArray(player?.hand) ? player.hand.length : 0;
    if (handCount < 2) return 0;
    const unknownCount = unknownHandCount(player);
    const knownCounts = knownHandRankCounts(player);
    const remaining = belief.remainingRankCounts(gameState);

    return RANKS.reduce((sum, rank) => {
      const known = knownCounts[rank] || 0;
      const maxHits = Math.min(remaining[rank] || 0, unknownCount);
      let expected = 0;
      for (let hits = 0; hits <= maxHits; hits += 1) {
        const totalRank = known + hits;
        if (totalRank < 2) continue;
        expected += belief.probabilityOfRankCount(gameState, unknownCount, rank, hits) * comboBonusForCount(totalRank);
      }
      return sum + expected;
    }, 0);
  }

  function expectedFinalHandTableSynergy(player, gameState) {
    const handCount = Array.isArray(player?.hand) ? player.hand.length : 0;
    if (!handCount || (gameState?.drawPile?.length || 0) > 0 || handCount > 4) return 0;

    const visibleCounts = Object.fromEntries(RANKS.map((rank) => [rank, 0]));
    tableSlotsFor(player).forEach((slot) => {
      if (slot.faceUp?.rank) visibleCounts[slot.faceUp.rank] += 1;
    });
    const knownCounts = knownHandRankCounts(player);
    const knownTotal = knownHandFor(player).length;
    const unknownCount = unknownHandCount(player);

    return RANKS.reduce((sum, rank) => {
      if (!visibleCounts[rank]) return sum;
      const knownOfRank = knownCounts[rank] || 0;
      if (knownTotal && knownOfRank !== knownTotal) return sum;
      const pAllUnknownRank = unknownCount
        ? belief.probabilityOfRankCount(gameState, unknownCount, rank, unknownCount)
        : 1;
      const combined = handCount + visibleCounts[rank];
      const bonus = Math.max(0, comboBonusForCount(combined) - comboBonusForCount(handCount));
      return sum + pAllUnknownRank * bonus;
    }, 0);
  }

  function comboStrength(player, gameState) {
    const c = countsFor(player);
    if (c.hand === 0) return exactVisibleComboStrength(player);
    return expectedHandComboStrength(player, gameState) + expectedFinalHandTableSynergy(player, gameState);
  }

  function legalUnseenCount(gameState) {
    const remaining = belief.remainingRankCounts(gameState);
    return RANKS.reduce(
      (sum, rank) => sum + (baseRisk.canPlayRank(rank, gameState) ? (remaining[rank] || 0) : 0),
      0,
    );
  }

  function probabilityNoLegalInHiddenSet(gameState, hiddenCount) {
    const total = belief.unseenCardCount(gameState);
    const draws = Math.max(0, Math.min(Number(hiddenCount) || 0, total));
    if (!draws || !total) return draws ? 1 : 0;
    const legal = legalUnseenCount(gameState);
    const illegal = total - legal;
    if (illegal < draws) return 0;

    let probability = 1;
    for (let i = 0; i < draws; i += 1) probability *= (illegal - i) / (total - i);
    return probability;
  }

  function knownPlayableExists(player, gameState) {
    return knownHandFor(player).some((card) => baseRisk.canPlayRank(card.rank, gameState));
  }

  function visiblePlayableExists(player, gameState) {
    return tableSlotsFor(player).some((slot) => slot.faceUp && baseRisk.canPlayRank(slot.faceUp.rank, gameState));
  }

  function exposedBlindCount(player) {
    return tableSlotsFor(player).filter((slot) => slot.hasFaceDown && !slot.faceUp).length;
  }

  function noLegalProbability(player, gameState) {
    const c = countsFor(player);
    if (!c.total || !(gameState?.discard?.length || 0)) return 0;
    if (c.hand > 0 || (gameState?.drawPile?.length || 0) > 0) {
      if (knownPlayableExists(player, gameState)) return 0;
      const unknown = unknownHandCount(player);
      return unknown ? probabilityNoLegalInHiddenSet(gameState, unknown) : 1;
    }
    if (visiblePlayableExists(player, gameState)) return 0;
    if (exposedBlindCount(player) > 0) return probabilityNoLegalInHiddenSet(gameState, 1);
    return 1;
  }

  function activeTurnDistance(id, gameState) {
    const ids = Object.keys(gameState?.players || {}).filter((playerId) => !isOut(gameState.players[playerId]));
    if (!ids.length) return Infinity;
    const currentIndex = ids.indexOf(gameState?.currentPlayer);
    const playerIndex = ids.indexOf(id);
    if (currentIndex < 0 || playerIndex < 0) return Infinity;
    return (playerIndex - currentIndex + ids.length) % ids.length;
  }

  function pickupDanger(id, player, gameState, config) {
    const pileSize = Array.isArray(gameState?.discard) ? gameState.discard.length : 0;
    if (!pileSize || isOut(player)) return 0;
    const distance = activeTurnDistance(id, gameState);
    const weight = config.futureTurnWeights[distance] ?? 0;
    if (!weight) return 0;
    const severity = config.pickupBase + config.pickupLogWeight * Math.log1p(pileSize);
    return weight * noLegalProbability(player, gameState) * severity;
  }

  function calculatePublicRiskDetails(gameState, options) {
    const config = mergeConfig(options);
    const ids = Object.keys(gameState?.players || {});

    if (gameState?.phase === 'gameover' && gameState?.shitHead) {
      return Object.fromEntries(ids.map((id) => [id, {
        out: id !== gameState.shitHead,
        riskScore: id === gameState.shitHead ? 100 : -Infinity,
        components: { burden: 0, cardQuality: 0, tableTrap: 0, pickupDanger: 0, comboStrength: 0 },
      }]));
    }

    return Object.fromEntries(ids.map((id) => {
      const player = gameState.players[id];
      const c = countsFor(player);
      if (!c.total) {
        return [id, {
          out: true,
          riskScore: -Infinity,
          components: { burden: 0, cardQuality: 0, tableTrap: 0, pickupDanger: 0, comboStrength: 0 },
        }];
      }

      const burden = c.hand * config.burden.hand + c.faceUp * config.burden.faceUp + c.faceDown * config.burden.faceDown;
      const expectedHand = expectedHandUtility(player, gameState);
      const expectedBlind = expectedHiddenUtility(gameState, c.faceDown) * config.blindUtilityWeight;
      const visible = visibleUtility(player, gameState);
      const cardQuality = -(expectedHand + expectedBlind + visible) * config.cardQualityWeight;
      const trap = tableTrap(player, config);
      const danger = pickupDanger(id, player, gameState, config);
      const combos = comboStrength(player, gameState);
      const riskScore = burden + cardQuality + trap + danger - combos;

      return [id, {
        out: false,
        riskScore,
        components: {
          burden,
          cardQuality,
          tableTrap: trap,
          pickupDanger: danger,
          comboStrength: combos,
        },
      }];
    }));
  }

  function calculatePublicShitheadProbability(gameState, options) {
    const config = mergeConfig(options);
    const details = calculatePublicRiskDetails(gameState, config);
    const ids = Object.keys(details);
    const active = ids.filter((id) => Number.isFinite(details[id].riskScore));
    if (!active.length) return Object.fromEntries(ids.map((id) => [id, 0]));
    if (active.length === 1) return Object.fromEntries(ids.map((id) => [id, id === active[0] ? 100 : 0]));

    const maxScore = Math.max(...active.map((id) => details[id].riskScore));
    const raw = Object.fromEntries(active.map((id) => [id, Math.exp((details[id].riskScore - maxScore) / config.temperature)]));
    const denominator = active.reduce((sum, id) => sum + raw[id], 0) || 1;
    return Object.fromEntries(ids.map((id) => [id, active.includes(id) ? (raw[id] / denominator) * 100 : 0]));
  }

  return Object.freeze({
    version: 'public-belief-v1.1',
    DEFAULTS,
    calculatePublicRiskDetails,
    calculatePublicShitheadProbability,
  });
});