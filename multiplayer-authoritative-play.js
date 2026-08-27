// Authoritative multiplayer play transport.
// Loaded after PeerJS but BEFORE multiplayer.js so we can capture the PeerJS
// data connections without exposing the multiplayer module's private state.
// Client browsers send only an intent (player + card indices). The host executes
// the existing game engine and broadcasts the resulting authoritative state.
(() => {
  if (typeof Peer === 'undefined') return;

  let clientConnection = null;
  const originalConnect = Peer.prototype.connect;
  const originalOn = Peer.prototype.on;

  function normaliseIndices(indices, handLength) {
    if (!Array.isArray(indices)) return [];
    return [...new Set(indices)]
      .filter((index) => Number.isInteger(index) && index >= 0 && index < handLength)
      .sort((a, b) => a - b);
  }

  function attachHostActionListener(conn) {
    if (!conn || conn.__shitHeadAuthoritativePlayHook) return;
    conn.__shitHeadAuthoritativePlayHook = true;

    conn.on('data', (data) => {
      if (!data || data.type !== 'authoritative-play') return;
      if (typeof state === 'undefined' || typeof playSelected !== 'function') return;

      const player = data.player;
      if (!PLAYER_NAMES.includes(player)) return;
      if (state.phase !== 'play' || state.currentPlayer !== player) return;

      const hand = state.players?.[player]?.hand || [];
      const indices = normaliseIndices(data.indices, hand.length);
      if (!indices.length) return;

      state.selected = indices;
      playSelected(player);
      window.ShitHeadMultiplayer?.publishState?.();
    });
  }

  Peer.prototype.connect = function connectWithAuthoritativePlay(...args) {
    const conn = originalConnect.apply(this, args);
    clientConnection = conn;
    return conn;
  };

  Peer.prototype.on = function onWithAuthoritativePlay(eventName, callback, ...rest) {
    if (eventName === 'connection' && typeof callback === 'function') {
      const wrapped = function wrappedConnection(conn, ...args) {
        attachHostActionListener(conn);
        return callback.call(this, conn, ...args);
      };
      return originalOn.call(this, eventName, wrapped, ...rest);
    }
    return originalOn.call(this, eventName, callback, ...rest);
  };

  window.ShitHeadAuthoritativePlay = {
    send(player, indices) {
      if (!clientConnection || !clientConnection.open) return false;
      clientConnection.send({ type: 'authoritative-play', player, indices: [...indices] });
      return true;
    },
  };
})();
