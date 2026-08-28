// 0.9.18 compatibility facade.
// Multiplayer transport now lives inside multiplayer.js. Keep this public helper
// so the existing selection UI does not need a second transport implementation.
(() => {
  function multiplayer() {
    return window.ShitHeadMultiplayer;
  }

  function correctPlayer(player) {
    const mp = multiplayer();
    return !!mp && mp.status?.role === 'client' && mp.status?.player === player;
  }

  function cleanRefs(refs) {
    if (!Array.isArray(refs)) return [];
    return refs
      .filter((ref) => ref && (ref.zone === 'hand' || ref.zone === 'faceUp') && Number.isInteger(ref.index))
      .map((ref) => ({ zone: ref.zone, index: ref.index }));
  }

  window.ShitHeadAuthoritativePlay = {
    send(player, refs) {
      if (!correctPlayer(player)) return false;
      const clean = cleanRefs(refs);
      if (!clean.length) return false;
      return multiplayer().sendAction?.({ type: 'play', refs: clean }) === true;
    },

    sendBlind(player, slotIndex) {
      if (!correctPlayer(player) || !Number.isInteger(Number(slotIndex))) return false;
      return multiplayer().sendAction?.({ type: 'blind', slotIndex: Number(slotIndex) }) === true;
    },

    sendTurnAction(player, action) {
      if (!correctPlayer(player) || !['pickup', 'finish', 'sort'].includes(action)) return false;
      return multiplayer().sendAction?.({ type: action }) === true;
    },
  };
})();