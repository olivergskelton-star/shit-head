// Shithead viewer-aware risk v1.4
//
// Risk uses the current viewer's hand plus a belief state over genuinely unseen
// cards. It NEVER reads an opponent's hidden hand, any face-down identity or a
// draw-pile identity. Public pickups remain known via player.knownHand.
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
    rolloutSamples: 128,
    maxRolloutActions: 700,
    burdenBlend: 0.35,
    burdenTemperature: 2.5,
    burdenZoneWeights: Object.freeze({ hand: 1, faceUp: 1.15, faceDown: 1.35 }),
  });

  const NORMAL_ORDER = ['4', '5', '6', '7', '8', '9', 'J', 'Q', 'K', 'A'];
  const ROLLOUT_CACHE = new Map();
  const MAX_CACHE_ENTRIES = 32;

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
      burdenZoneWeights: { ...DEFAULTS.burdenZoneWeights, ...(input.burdenZoneWeights || {}) },
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

  function playWouldBurn(rank, playedCount, gameState) {
    if (rank === '10') return true;
    const run = topRun(gameState?.discard);
    const existing = run.rank === rank ? run.count : 0;
    const combined = existing + Math.max(0, Number(playedCount) || 0);
    return rank === '8' ? combined >= 3 : combined >= 4;
  }

  // Resolve public, deterministic exits before applying the heuristic model.
  // This only follows visible face-up cards and the fact that any single blind
  // card is playable on an empty pile; it never inspects a hidden identity.
  function hasForcedPublicExit(id, player, gameState) {
    if (gameState?.phase !== 'play' || gameState?.currentPlayer !== id) return false;
    if ((gameState?.drawPile?.length || 0) > 0 || (player?.hand?.length || 0) > 0) return false;

    const slots = tableSlotsFor(player);
    const faceUps = slots.map((slot) => slot.faceUp).filter(Boolean);
    const blindCount = slots.filter((slot) => slot.hasFaceDown).length;

    function canExit(remainingFaceUps, discard, followUpRank) {
      if (!remainingFaceUps.length) {
        if (!blindCount) return true;
        // The rank is immaterial: with no discard, the last blind card must play.
        return blindCount === 1 && discard.length === 0 && !followUpRank;
      }

      const ranks = [...new Set(remainingFaceUps.map((card) => card.rank).filter(Boolean))];
      return ranks.some((rank) => {
        const localState = { ...gameState, discard, followUpRank };
        if (!baseRisk.canPlayRank(rank, localState)) return false;

        const played = remainingFaceUps.filter((card) => card.rank === rank);
        const left = remainingFaceUps.filter((card) => card.rank !== rank);

        if (playWouldBurn(rank, played.length, localState)) {
          return canExit(left, [], null);
        }

        // A non-burning play only guarantees safety when it plays the player out.
        return left.length === 0 && blindCount === 0;
      });
    }

    return canExit(faceUps, Array.isArray(gameState?.discard) ? gameState.discard : [], gameState?.followUpRank || null);
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
        guaranteedSafe: false,
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
          guaranteedSafe: false,
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
        guaranteedSafe: hasForcedPublicExit(id, player, gameState),
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

  function calculateHeuristicShitheadProbability(gameState, options) {
    const config = mergeConfig(options);
    const details = calculatePublicRiskDetails(gameState, config);
    const ids = Object.keys(details);
    const active = ids.filter((id) => Number.isFinite(details[id].riskScore) && !details[id].guaranteedSafe);
    if (!active.length) return Object.fromEntries(ids.map((id) => [id, 0]));
    if (active.length === 1) return Object.fromEntries(ids.map((id) => [id, id === active[0] ? 100 : 0]));

    const maxScore = Math.max(...active.map((id) => details[id].riskScore));
    const raw = Object.fromEntries(active.map((id) => [id, Math.exp((details[id].riskScore - maxScore) / config.temperature)]));
    const denominator = active.reduce((sum, id) => sum + raw[id], 0) || 1;
    return Object.fromEntries(ids.map((id) => [id, active.includes(id) ? (raw[id] / denominator) * 100 : 0]));
  }

  function rankOf(card) {
    return card && typeof card.rank === 'string' ? card.rank : null;
  }

  function completeViewerHandRanks(gameState, viewerId) {
    const hand = gameState?.players?.[viewerId]?.hand;
    if (!viewerId || !Array.isArray(hand) || !hand.every((card) => !!rankOf(card))) return null;
    return hand.map(rankOf);
  }

  function fixedHandRanks(gameState, id, viewerId) {
    const viewerRanks = id === viewerId ? completeViewerHandRanks(gameState, viewerId) : null;
    return viewerRanks || knownHandFor(gameState?.players?.[id]).map((card) => card.rank);
  }

  function hiddenHandCountFor(gameState, id, viewerId) {
    const player = gameState?.players?.[id];
    return Math.max(0, (player?.hand?.length || 0) - fixedHandRanks(gameState, id, viewerId).length);
  }

  function viewerRemainingRankCounts(gameState, viewerId) {
    const remaining = belief.remainingRankCounts(gameState);
    const viewerRanks = completeViewerHandRanks(gameState, viewerId);
    if (!viewerRanks) return remaining;

    const actual = Object.fromEntries(RANKS.map((rank) => [rank, 0]));
    const alreadyPublic = Object.fromEntries(RANKS.map((rank) => [rank, 0]));
    viewerRanks.forEach((rank) => { if (actual[rank] !== undefined) actual[rank] += 1; });
    knownHandFor(gameState.players[viewerId]).forEach((card) => {
      if (alreadyPublic[card.rank] !== undefined) alreadyPublic[card.rank] += 1;
    });
    return Object.fromEntries(RANKS.map((rank) => [
      rank,
      Math.max(0, remaining[rank] - Math.max(0, actual[rank] - alreadyPublic[rank])),
    ]));
  }

  function publicStateSignature(gameState, viewerId) {
    const ids = Object.keys(gameState?.players || {});
    const burnCounts = Object.fromEntries(RANKS.map((rank) => [rank, 0]));
    (gameState?.burnPile || []).forEach((card) => {
      const rank = rankOf(card);
      if (rank) burnCounts[rank] += 1;
    });
    const parts = [
      'rollout-v2',
      viewerId || '-',
      gameState?.phase || '-',
      gameState?.currentPlayer || '-',
      gameState?.followUpRank || '-',
      String(gameState?.drawPile?.length || 0),
      (gameState?.discard || []).map((card) => rankOf(card) || '-').join(','),
      RANKS.map((rank) => burnCounts[rank]).join(','),
    ];
    ids.forEach((id) => {
      const player = gameState.players[id];
      const slots = tableSlotsFor(player);
      parts.push(
        id,
        String(player?.hand?.length || 0),
        knownHandFor(player).map((card) => card.rank).sort().join(','),
        slots.map((slot) => `${rankOf(slot.faceUp) || '-'}:${slot.hasFaceDown ? 1 : 0}`).join(','),
      );
    });
    const viewerRanks = completeViewerHandRanks(gameState, viewerId);
    if (viewerRanks) parts.push('viewer-hand', [...viewerRanks].sort().join(','));
    return parts.join('~');
  }

  function hashString(value) {
    let hash = 0x811C9DC5;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  }

  function samplingSeedSignature(gameState, viewerId) {
    const remaining = viewerRemainingRankCounts(gameState, viewerId);
    const ids = Object.keys(gameState?.players || {});
    return [
      'unseen-world-v2',
      viewerId || '-',
      RANKS.map((rank) => remaining[rank] || 0).join(','),
      String(gameState?.drawPile?.length || 0),
      ...ids.flatMap((id) => {
        const player = gameState.players[id];
        return [
          id,
          String(hiddenHandCountFor(gameState, id, viewerId)),
          tableSlotsFor(player).map((slot) => slot.hasFaceDown ? '1' : '0').join(''),
        ];
      }),
    ].join('~');
  }

  function makeRng(seed) {
    let state = (Number(seed) || 1) >>> 0;
    return function random() {
      state += 0x6D2B79F5;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffleInPlace(items, random) {
    for (let index = items.length - 1; index > 0; index -= 1) {
      const other = Math.floor(random() * (index + 1));
      [items[index], items[other]] = [items[other], items[index]];
    }
    return items;
  }

  function instantiatePublicState(gameState, random, viewerId) {
    const ids = Object.keys(gameState?.players || {});
    const remaining = viewerRemainingRankCounts(gameState, viewerId);
    const unseen = RANKS.flatMap((rank) => Array.from({ length: remaining[rank] || 0 }, () => rank));
    const hiddenSlots = (gameState?.drawPile?.length || 0) + ids.reduce((sum, id) => {
      const player = gameState.players[id];
      return sum + hiddenHandCountFor(gameState, id, viewerId) + tableSlotsFor(player).filter((slot) => slot.hasFaceDown).length;
    }, 0);
    if (hiddenSlots !== unseen.length) return null;

    shuffleInPlace(unseen, random);
    const take = () => unseen.pop();
    const players = Object.fromEntries(ids.map((id) => {
      const source = gameState.players[id];
      const hand = fixedHandRanks(gameState, id, viewerId);
      for (let index = 0; index < hiddenHandCountFor(gameState, id, viewerId); index += 1) hand.push(take());
      const tableSlots = tableSlotsFor(source).map((slot) => ({
        faceUp: rankOf(slot.faceUp),
        faceDown: slot.hasFaceDown ? take() : null,
      }));
      return [id, { hand, tableSlots }];
    }));
    const drawPile = [];
    for (let index = 0; index < (gameState?.drawPile?.length || 0); index += 1) drawPile.push(take());
    if (unseen.length) return null;

    return {
      ids,
      phase: gameState?.phase || 'play',
      currentPlayer: gameState?.currentPlayer || ids[0] || null,
      followUpRank: gameState?.followUpRank || null,
      drawPile,
      discard: (gameState?.discard || []).map(rankOf).filter(Boolean),
      players,
      loser: gameState?.shitHead || null,
    };
  }

  function rolloutPlayerOut(state, id) {
    const player = state.players[id];
    return !player || (player.hand.length === 0 && !player.tableSlots.some((slot) => slot.faceUp || slot.faceDown));
  }

  function rolloutLiving(state) {
    return state.ids.filter((id) => !rolloutPlayerOut(state, id));
  }

  function rolloutConclude(state) {
    const living = rolloutLiving(state);
    if (living.length > 1) return false;
    state.phase = 'gameover';
    state.loser = living[0] || null;
    state.currentPlayer = state.loser;
    state.followUpRank = null;
    return true;
  }

  function rolloutAdvance(state, fromId) {
    if (rolloutConclude(state)) return;
    const start = Math.max(0, state.ids.indexOf(fromId));
    for (let offset = 1; offset <= state.ids.length; offset += 1) {
      const candidate = state.ids[(start + offset) % state.ids.length];
      if (!rolloutPlayerOut(state, candidate)) {
        state.currentPlayer = candidate;
        return;
      }
    }
  }

  function rolloutEffectiveTop(state) {
    for (let index = state.discard.length - 1; index >= 0; index -= 1) {
      if (state.discard[index] !== '3') return state.discard[index];
    }
    return null;
  }

  function rolloutCanPlay(state, rank) {
    if (state.followUpRank && rank !== state.followUpRank) return false;
    if (rank === '2' || rank === '3' || rank === '10') return true;
    const target = rolloutEffectiveTop(state);
    if (!target || target === '2') return true;
    const candidateValue = NORMAL_ORDER.indexOf(rank);
    if (target === '7') return candidateValue !== -1 && candidateValue <= NORMAL_ORDER.indexOf('7');
    const targetValue = NORMAL_ORDER.indexOf(target);
    return candidateValue !== -1 && targetValue !== -1 && candidateValue >= targetValue;
  }

  function rolloutTopCount(state, rank) {
    let count = 0;
    for (let index = state.discard.length - 1; index >= 0; index -= 1) {
      if (state.discard[index] !== rank) break;
      count += 1;
    }
    return count;
  }

  function rolloutShouldBurn(state, rank) {
    if (rank === '10') return true;
    const count = rolloutTopCount(state, rank);
    return rank === '8' ? count >= 3 : count >= 4;
  }

  function rolloutRefill(state, player) {
    while (player.hand.length < 3 && state.drawPile.length) player.hand.push(state.drawPile.pop());
  }

  function rolloutHasFollowUp(state, id, rank) {
    const player = state.players[id];
    if (rolloutPlayerOut(state, id)) return false;
    if (player.hand.includes(rank)) return true;
    return state.drawPile.length === 0 && player.hand.length === 0
      && player.tableSlots.some((slot) => slot.faceUp === rank);
  }

  function rolloutPlay(state, id, rank) {
    const player = state.players[id];
    const useHand = player.hand.length > 0 || state.drawPile.length > 0;
    let played = 0;
    if (useHand) {
      const before = player.hand.length;
      player.hand = player.hand.filter((cardRank) => cardRank !== rank);
      played = before - player.hand.length;
      // The real game permits a final same-rank hand to be laid with matching face-up cards.
      if (!state.drawPile.length && player.hand.length === 0) {
        player.tableSlots.forEach((slot) => {
          if (slot.faceUp === rank) {
            slot.faceUp = null;
            played += 1;
          }
        });
      }
    } else {
      player.tableSlots.forEach((slot) => {
        if (slot.faceUp === rank) {
          slot.faceUp = null;
          played += 1;
        }
      });
    }
    if (!played) return false;

    for (let index = 0; index < played; index += 1) state.discard.push(rank);
    rolloutRefill(state, player);
    const burned = rolloutShouldBurn(state, rank);
    const becameOut = rolloutPlayerOut(state, id);
    if (burned) {
      state.discard = [];
      state.followUpRank = null;
      if (becameOut) rolloutAdvance(state, id);
      else rolloutConclude(state);
      return true;
    }
    if (becameOut) {
      state.followUpRank = null;
      rolloutAdvance(state, id);
    } else if (rolloutHasFollowUp(state, id, rank)) {
      state.followUpRank = rank;
    } else {
      state.followUpRank = null;
      rolloutAdvance(state, id);
    }
    return true;
  }

  function rolloutBlind(state, id, slotIndex) {
    const player = state.players[id];
    const slot = player.tableSlots[slotIndex];
    const rank = slot.faceDown;
    slot.faceDown = null;
    state.followUpRank = null;
    if (!rolloutCanPlay(state, rank)) {
      player.hand.push(...state.discard, rank);
      state.discard = [];
      rolloutAdvance(state, id);
      return true;
    }
    state.discard.push(rank);
    const burned = rolloutShouldBurn(state, rank);
    const becameOut = rolloutPlayerOut(state, id);
    if (burned) {
      state.discard = [];
      if (becameOut) rolloutAdvance(state, id);
      else rolloutConclude(state);
    } else if (becameOut) {
      rolloutAdvance(state, id);
    } else {
      rolloutAdvance(state, id);
    }
    return true;
  }

  function rolloutPickup(state, id) {
    state.players[id].hand.push(...state.discard);
    state.discard = [];
    state.followUpRank = null;
    rolloutAdvance(state, id);
  }

  function rankActionScore(state, player, rank, count) {
    const existing = rolloutTopCount(state, rank);
    const burns = rank === '10' || (rank === '8' ? existing + count >= 3 : existing + count >= 4);
    const cardsBefore = player.hand.length + player.tableSlots.filter((slot) => slot.faceUp || slot.faceDown).length;
    const drawsAfter = Math.min(Math.max(0, 3 - (player.hand.length - count)), state.drawPile.length);
    const playsOut = cardsBefore - count + drawsAfter === 0;
    return (playsOut ? 1000 : 0) + (burns ? 90 : 0) + count * 18 - (BASE_UTILITY[rank] || 0) * 2;
  }

  function rolloutChooseAndPlay(state, id, random) {
    const player = state.players[id];
    if (state.followUpRank) {
      const rank = state.followUpRank;
      const available = player.hand.filter((item) => item === rank).length
        || (state.drawPile.length === 0 && player.hand.length === 0
          ? player.tableSlots.filter((slot) => slot.faceUp === rank).length
          : 0);
      if (available && rolloutCanPlay(state, rank)) return rolloutPlay(state, id, rank);
      state.followUpRank = null;
      rolloutAdvance(state, id);
      return true;
    }

    if (player.hand.length > 0 || state.drawPile.length > 0) {
      const counts = {};
      player.hand.forEach((rank) => { counts[rank] = (counts[rank] || 0) + 1; });
      const legal = Object.keys(counts).filter((rank) => rolloutCanPlay(state, rank));
      if (legal.length) {
        legal.sort((left, right) => {
          const score = rankActionScore(state, player, right, counts[right]) - rankActionScore(state, player, left, counts[left]);
          return score || RANKS.indexOf(left) - RANKS.indexOf(right);
        });
        return rolloutPlay(state, id, legal[0]);
      }
      if (state.discard.length) {
        rolloutPickup(state, id);
        return true;
      }
      return false;
    }

    const faceCounts = {};
    player.tableSlots.forEach((slot) => {
      if (slot.faceUp) faceCounts[slot.faceUp] = (faceCounts[slot.faceUp] || 0) + 1;
    });
    const legalFaceUp = Object.keys(faceCounts).filter((rank) => rolloutCanPlay(state, rank));
    if (legalFaceUp.length) {
      legalFaceUp.sort((left, right) => {
        const score = rankActionScore(state, player, right, faceCounts[right]) - rankActionScore(state, player, left, faceCounts[left]);
        return score || RANKS.indexOf(left) - RANKS.indexOf(right);
      });
      return rolloutPlay(state, id, legalFaceUp[0]);
    }
    if (Object.keys(faceCounts).length && state.discard.length) {
      rolloutPickup(state, id);
      return true;
    }

    const blindSlots = player.tableSlots
      .map((slot, index) => ({ slot, index }))
      .filter(({ slot }) => slot.faceDown && !slot.faceUp);
    if (blindSlots.length) {
      const chosen = blindSlots[Math.floor(random() * blindSlots.length)];
      return rolloutBlind(state, id, chosen.index);
    }
    return false;
  }

  function fallbackRolloutLoser(state, random) {
    const living = rolloutLiving(state);
    if (!living.length) return null;
    const scores = living.map((id) => {
      const player = state.players[id];
      return {
        id,
        score: player.hand.length * 3
          + player.tableSlots.filter((slot) => slot.faceUp).length * 4
          + player.tableSlots.filter((slot) => slot.faceDown).length * 5,
      };
    });
    const max = Math.max(...scores.map((item) => item.score));
    const tied = scores.filter((item) => item.score === max);
    return tied[Math.floor(random() * tied.length)].id;
  }

  function rolloutPositionSignature(state) {
    const parts = [
      state.currentPlayer || '-',
      state.followUpRank || '-',
      state.drawPile.join(','),
      state.discard.join(','),
    ];
    state.ids.forEach((id) => {
      const player = state.players[id];
      parts.push(
        id,
        [...player.hand].sort().join(','),
        player.tableSlots.map((slot) => `${slot.faceUp || '-'}:${slot.faceDown || '-'}`).join(','),
      );
    });
    return parts.join('~');
  }

  function runPublicRollout(gameState, seed, maxActions, viewerId) {
    const random = makeRng(seed);
    const state = instantiatePublicState(gameState, random, viewerId);
    if (!state) return null;
    if (state.phase === 'gameover') return state.loser;
    rolloutConclude(state);
    const seen = new Map();
    let actions = 0;
    while (state.phase === 'play' && actions < maxActions) {
      const signature = rolloutPositionSignature(state);
      const visits = (seen.get(signature) || 0) + 1;
      seen.set(signature, visits);
      if (visits >= 3) return fallbackRolloutLoser(state, random);
      const id = state.currentPlayer;
      if (!id || rolloutPlayerOut(state, id) || !rolloutChooseAndPlay(state, id, random)) break;
      actions += 1;
    }
    return state.phase === 'gameover' ? state.loser : fallbackRolloutLoser(state, random);
  }

  function burdenPriorProbability(gameState, ids, eligible, config) {
    const weights = config.burdenZoneWeights;
    const scores = Object.fromEntries(eligible.map((id) => {
      const counts = countsFor(gameState.players[id]);
      return [id,
        counts.hand * weights.hand
        + counts.faceUp * weights.faceUp
        + counts.faceDown * weights.faceDown,
      ];
    }));
    const temperature = Math.max(0.5, Number(config.burdenTemperature) || DEFAULTS.burdenTemperature);
    const maxScore = Math.max(...eligible.map((id) => scores[id]));
    const raw = Object.fromEntries(eligible.map((id) => [id, Math.exp((scores[id] - maxScore) / temperature)]));
    const denominator = eligible.reduce((sum, id) => sum + raw[id], 0) || 1;
    return Object.fromEntries(ids.map((id) => [id, eligible.includes(id) ? (raw[id] / denominator) * 100 : 0]));
  }

  function calculateRolloutShitheadProbability(gameState, options) {
    const config = mergeConfig(options);
    const ids = Object.keys(gameState?.players || {});
    const viewerId = ids.includes(config.viewerId) ? config.viewerId : null;
    if (!ids.length) return {};
    if (gameState?.phase === 'gameover' && gameState?.shitHead) {
      return Object.fromEntries(ids.map((id) => [id, id === gameState.shitHead ? 100 : 0]));
    }

    const details = calculatePublicRiskDetails(gameState, config);
    const guaranteedSafe = new Set(ids.filter((id) => details[id]?.guaranteedSafe));
    const eligible = ids.filter((id) => !details[id]?.out && !guaranteedSafe.has(id));
    if (!eligible.length) return Object.fromEntries(ids.map((id) => [id, 0]));
    if (eligible.length === 1) return Object.fromEntries(ids.map((id) => [id, id === eligible[0] ? 100 : 0]));

    const samples = Math.max(32, Math.min(2048, Math.round(Number(config.rolloutSamples) || DEFAULTS.rolloutSamples)));
    const maxActions = Math.max(100, Math.min(2500, Math.round(Number(config.maxRolloutActions) || DEFAULTS.maxRolloutActions)));
    const signature = publicStateSignature(gameState, viewerId);
    const blend = Math.max(0, Math.min(0.8, Number(config.burdenBlend) || 0));
    const burdenKey = ['hand', 'faceUp', 'faceDown'].map((zone) => config.burdenZoneWeights[zone]).join(',');
    const cacheKey = `${signature}~${samples}~${maxActions}~${blend}~${config.burdenTemperature}~${burdenKey}`;
    if (ROLLOUT_CACHE.has(cacheKey)) return { ...ROLLOUT_CACHE.get(cacheKey) };

    const counts = Object.fromEntries(ids.map((id) => [id, 0]));
    // Positions with the same unknown-card pool and hidden-zone layout sample the
    // same possible worlds. This removes Monte Carlo wobble across a public move.
    const baseSeed = hashString(samplingSeedSignature(gameState, viewerId));
    let completed = 0;
    for (let index = 0; index < samples; index += 1) {
      const seed = (baseSeed + Math.imul(index + 1, 0x9E3779B9)) >>> 0;
      const loser = runPublicRollout(gameState, seed, maxActions, viewerId);
      if (loser && eligible.includes(loser)) {
        counts[loser] += 1;
        completed += 1;
      }
    }
    if (!completed) return null;
    // Jeffreys smoothing prevents a merely unobserved loss from being displayed as
    // impossible. Publicly proven exits above remain the only exact zeroes.
    const prior = 0.5;
    const denominator = completed + prior * eligible.length;
    const rolloutProbabilities = Object.fromEntries(ids.map((id) => [
      id,
      eligible.includes(id) ? ((counts[id] + prior) / denominator) * 100 : 0,
    ]));
    const burdenProbabilities = burdenPriorProbability(gameState, ids, eligible, config);
    const probabilities = Object.fromEntries(ids.map((id) => [
      id,
      rolloutProbabilities[id] * (1 - blend) + burdenProbabilities[id] * blend,
    ]));
    ROLLOUT_CACHE.set(cacheKey, probabilities);
    if (ROLLOUT_CACHE.size > MAX_CACHE_ENTRIES) ROLLOUT_CACHE.delete(ROLLOUT_CACHE.keys().next().value);
    return { ...probabilities };
  }

  function calculatePublicShitheadProbability(gameState, options) {
    return calculateRolloutShitheadProbability(gameState, options)
      || calculateHeuristicShitheadProbability(gameState, options);
  }

  return Object.freeze({
    version: 'viewer-belief-v1.4',
    DEFAULTS,
    calculatePublicRiskDetails,
    calculateHeuristicShitheadProbability,
    calculateRolloutShitheadProbability,
    calculatePublicShitheadProbability,
  });
});
