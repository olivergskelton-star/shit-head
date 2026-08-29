// Shithead public belief state v1
//
// This module NEVER uses the identities of hidden hands, face-down table cards,
// or draw-pile cards. It starts from the public cards that have actually been
// revealed and treats every remaining card as an unknown distributed across the
// remaining hidden positions.
(function initShitheadBeliefStateV1(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ShitHeadBeliefStateV1 = api;
})(typeof window !== 'undefined' ? window : null, function buildBeliefApi() {
  const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const COPIES_PER_RANK = 4;

  function rankOf(card) {
    return card && typeof card.rank === 'string' ? card.rank : null;
  }

  function combination(n, k) {
    if (!Number.isInteger(n) || !Number.isInteger(k) || k < 0 || n < 0 || k > n) return 0;
    if (k === 0 || k === n) return 1;
    const kk = Math.min(k, n - k);
    let result = 1;
    for (let i = 1; i <= kk; i += 1) result = (result * (n - kk + i)) / i;
    return result;
  }

  function hypergeometric(total, successes, draws, hits) {
    if (draws > total || hits > successes || hits < 0 || draws - hits > total - successes) return 0;
    const denominator = combination(total, draws);
    if (!denominator) return 0;
    return (combination(successes, hits) * combination(total - successes, draws - hits)) / denominator;
  }

  function tableSlotsFor(player) {
    if (!player) return [];
    if (Array.isArray(player.tableSlots) && player.tableSlots.length) {
      return [0, 1, 2].map((index) => ({
        faceUp: player.tableSlots[index]?.faceUp || null,
        faceDown: player.tableSlots[index]?.faceDown || null,
      }));
    }
    const ups = Array.isArray(player.faceUp) ? player.faceUp : [];
    const downs = Array.isArray(player.faceDown) ? player.faceDown : [];
    return [0, 1, 2].map((index) => ({
      faceUp: ups[index] || null,
      faceDown: downs[index] || null,
    }));
  }

  function addKnown(counts, card) {
    const rank = rankOf(card);
    if (rank && Object.prototype.hasOwnProperty.call(counts, rank)) counts[rank] += 1;
  }

  function publicKnownRankCounts(gameState) {
    const counts = Object.fromEntries(RANKS.map((rank) => [rank, 0]));

    // These identities are visible/public.
    (gameState?.discard || []).forEach((card) => addKnown(counts, card));
    (gameState?.burnPile || []).forEach((card) => addKnown(counts, card));
    Object.values(gameState?.players || {}).forEach((player) => {
      tableSlotsFor(player).forEach((slot) => addKnown(counts, slot.faceUp));
    });

    return counts;
  }

  function remainingRankCounts(gameState) {
    const known = publicKnownRankCounts(gameState);
    return Object.fromEntries(RANKS.map((rank) => [rank, Math.max(0, COPIES_PER_RANK - known[rank])]));
  }

  function playerHiddenCount(player) {
    if (!player) return 0;
    const hand = Array.isArray(player.hand) ? player.hand.length : 0;
    const faceDown = tableSlotsFor(player).filter((slot) => !!slot.faceDown).length;
    return hand + faceDown;
  }

  function hiddenZoneCounts(gameState) {
    const players = Object.fromEntries(Object.entries(gameState?.players || {}).map(([id, player]) => [id, {
      hand: Array.isArray(player?.hand) ? player.hand.length : 0,
      faceDown: tableSlotsFor(player).filter((slot) => !!slot.faceDown).length,
      total: playerHiddenCount(player),
    }]));

    return {
      players,
      drawPile: Array.isArray(gameState?.drawPile) ? gameState.drawPile.length : 0,
    };
  }

  function unseenCardCount(gameState) {
    return Object.values(remainingRankCounts(gameState)).reduce((sum, count) => sum + count, 0);
  }

  function probabilityOfRankCount(gameState, hiddenCardCount, rank, hits) {
    const remaining = remainingRankCounts(gameState);
    const total = unseenCardCount(gameState);
    const rankRemaining = remaining[rank] || 0;
    const draws = Math.max(0, Math.min(Number(hiddenCardCount) || 0, total));
    return hypergeometric(total, rankRemaining, draws, hits);
  }

  function probabilityAtLeastOneRank(gameState, hiddenCardCount, rank) {
    const remaining = remainingRankCounts(gameState);
    const total = unseenCardCount(gameState);
    const rankRemaining = remaining[rank] || 0;
    const draws = Math.max(0, Math.min(Number(hiddenCardCount) || 0, total));
    if (!draws || !rankRemaining || !total) return 0;
    return 1 - hypergeometric(total, rankRemaining, draws, 0);
  }

  function expectedRankCount(gameState, hiddenCardCount, rank) {
    const remaining = remainingRankCounts(gameState);
    const total = unseenCardCount(gameState);
    const draws = Math.max(0, Math.min(Number(hiddenCardCount) || 0, total));
    if (!draws || !total) return 0;
    return draws * ((remaining[rank] || 0) / total);
  }

  function rankDistributionForHiddenSet(gameState, hiddenCardCount) {
    const total = unseenCardCount(gameState);
    const draws = Math.max(0, Math.min(Number(hiddenCardCount) || 0, total));
    const remaining = remainingRankCounts(gameState);

    return Object.fromEntries(RANKS.map((rank) => {
      const maxHits = Math.min(remaining[rank] || 0, draws);
      const probabilities = [];
      for (let hits = 0; hits <= maxHits; hits += 1) {
        probabilities.push(probabilityOfRankCount(gameState, draws, rank, hits));
      }
      return [rank, {
        remaining: remaining[rank] || 0,
        expected: expectedRankCount(gameState, draws, rank),
        atLeastOne: probabilityAtLeastOneRank(gameState, draws, rank),
        probabilities,
      }];
    }));
  }

  function playerBeliefs(gameState) {
    return Object.fromEntries(Object.entries(gameState?.players || {}).map(([id, player]) => {
      const zones = {
        hand: Array.isArray(player?.hand) ? player.hand.length : 0,
        faceDown: tableSlotsFor(player).filter((slot) => !!slot.faceDown).length,
      };
      return [id, {
        hiddenCards: zones.hand + zones.faceDown,
        handCards: zones.hand,
        faceDownCards: zones.faceDown,
        allHidden: rankDistributionForHiddenSet(gameState, zones.hand + zones.faceDown),
        hand: rankDistributionForHiddenSet(gameState, zones.hand),
        faceDown: rankDistributionForHiddenSet(gameState, zones.faceDown),
      }];
    }));
  }

  function snapshot(gameState) {
    const remaining = remainingRankCounts(gameState);
    const zones = hiddenZoneCounts(gameState);
    const unseen = unseenCardCount(gameState);
    const allocatedHiddenSlots = Object.values(zones.players).reduce((sum, player) => sum + player.total, 0) + zones.drawPile;

    return {
      remaining,
      unseenCards: unseen,
      hiddenSlots: zones,
      allocatedHiddenSlots,
      allocationMatchesDeck: allocatedHiddenSlots === unseen,
      players: playerBeliefs(gameState),
    };
  }

  return Object.freeze({
    version: 'belief-v1',
    RANKS,
    publicKnownRankCounts,
    remainingRankCounts,
    hiddenZoneCounts,
    unseenCardCount,
    expectedRankCount,
    probabilityOfRankCount,
    probabilityAtLeastOneRank,
    rankDistributionForHiddenSet,
    playerBeliefs,
    snapshot,
  });
});
