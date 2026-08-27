// Authoritative multiplayer play transport.
// Clients send only play intent. The host executes the real game engine and
// broadcasts the resulting authoritative state.
(() => {
  if (typeof Peer === 'undefined') return;

  let clientConnection = null;
  const originalConnect = Peer.prototype.connect;
  const originalOn = Peer.prototype.on;

  function normaliseIndices(indices, sourceLength) {
    if (!Array.isArray(indices)) return [];
    return [...new Set(indices)]
      .filter((index) => Number.isInteger(index) && index >= 0 && index < sourceLength)
      .sort((a, b) => a - b);
  }

  function currentZone(player) {
    return window.ShitHeadTablePlay?.currentZone?.(player) || 'hand';
  }

  function sourceLength(player, zone) {
    if (window.ShitHeadTablePlay?.sourceLength) return window.ShitHeadTablePlay.sourceLength(player, zone);
    return zone === 'hand' ? (state.players?.[player]?.hand?.length || 0) : 0;
  }

  function attachHostActionListener(conn) {
    if (!conn || conn.__shitHeadAuthoritativePlayHook) return;
    conn.__shitHeadAuthoritativePlayHook = true;

    conn.on('data', (data) => {
      if (!data || typeof data !== 'object') return;
      if (typeof state === 'undefined') return;

      const player = data.player;
      if (!PLAYER_NAMES.includes(player)) return;
      if (state.phase !== 'play' || state.currentPlayer !== player) return;

      if (data.type === 'authoritative-play') {
        if (typeof playSelected !== 'function') return;
        const zone = data.zone === 'faceUp' ? 'faceUp' : 'hand';
        if (currentZone(player) !== zone) return;

        const indices = normaliseIndices(data.indices, sourceLength(player, zone));
        if (!indices.length) return;

        state.selected = indices;
        state.selectedZone = zone;
        playSelected(player);
        window.ShitHeadMultiplayer?.publishState?.();
        return;
      }

      if (data.type === 'authoritative-face-down') {
        if (currentZone(player) !== 'faceDown') return;
        const index = Number(data.index);
        if (!Number.isInteger(index) || index < 0 || index >= sourceLength(player, 'faceDown')) return;
        if (!window.ShitHeadTablePlay?.playFaceDown) return;

        window.ShitHeadTablePlay.playFaceDown(player, index);
        window.ShitHeadMultiplayer?.publishState?.();
      }
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
    send(player, indices, zone = 'hand') {
      if (!clientConnection || !clientConnection.open) return false;
      clientConnection.send({ type: 'authoritative-play', player, zone, indices: [...indices] });
      return true;
    },
    sendBlind(player, index) {
      if (!clientConnection || !clientConnection.open) return false;
      clientConnection.send({ type: 'authoritative-face-down', player, index });
      return true;
    },
  };
})();
