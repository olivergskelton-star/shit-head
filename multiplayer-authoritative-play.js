// 0.9.15 authoritative multiplayer card actions.
// Clients send only intent. The host validates/executes against the canonical
// table-slot engine and then broadcasts the resulting state.
(() => {
  if (typeof Peer === 'undefined') return;

  let clientConnection = null;
  const originalConnect = Peer.prototype.connect;
  const originalOn = Peer.prototype.on;

  function legacyRefs(data) {
    if (!Array.isArray(data?.indices)) return [];
    const zone = data.zone === 'faceUp' ? 'faceUp' : 'hand';
    return data.indices
      .filter((index) => Number.isInteger(index))
      .map((index) => ({ zone, index }));
  }

  function cleanRefs(refs) {
    if (!Array.isArray(refs)) return [];
    return refs
      .filter((ref) => ref && (ref.zone === 'hand' || ref.zone === 'faceUp') && Number.isInteger(ref.index))
      .map((ref) => ({ zone: ref.zone, index: ref.index }));
  }

  function publish() {
    window.ShitHeadMultiplayer?.publishState?.();
  }

  function attachHostActionListener(conn) {
    if (!conn || conn.__shitHeadAuthoritativePlayHook) return;
    conn.__shitHeadAuthoritativePlayHook = true;

    conn.on('data', (data) => {
      if (!data || typeof data !== 'object' || typeof state === 'undefined') return;

      const player = data.player;
      if (!PLAYER_NAMES.includes(player)) return;
      if (state.phase !== 'play' || state.currentPlayer !== player) return;

      if (data.type === 'authoritative-play') {
        const refs = cleanRefs(data.refs).length ? cleanRefs(data.refs) : legacyRefs(data);
        if (!refs.length || !window.ShitHeadTablePlay?.playRefs) return;
        window.ShitHeadTablePlay.playRefs(player, refs);
        publish();
        return;
      }

      if (data.type === 'authoritative-face-down') {
        const slotIndex = Number(data.slotIndex ?? data.index);
        if (!Number.isInteger(slotIndex) || !window.ShitHeadTablePlay?.playFaceDown) return;
        window.ShitHeadTablePlay.playFaceDown(player, slotIndex);
        publish();
        return;
      }

      if (data.type === 'authoritative-turn-action') {
        if (data.action === 'pickup' && typeof pickupDiscard === 'function') {
          pickupDiscard(player);
          publish();
          return;
        }
        if (data.action === 'finish' && typeof finishTurn === 'function') {
          finishTurn(player);
          publish();
        }
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
    send(player, refs) {
      if (!clientConnection || !clientConnection.open) return false;
      clientConnection.send({ type: 'authoritative-play', player, refs: cleanRefs(refs) });
      return true;
    },
    sendBlind(player, slotIndex) {
      if (!clientConnection || !clientConnection.open) return false;
      clientConnection.send({ type: 'authoritative-face-down', player, slotIndex });
      return true;
    },
    sendTurnAction(player, action) {
      if (!clientConnection || !clientConnection.open || !['pickup', 'finish'].includes(action)) return false;
      clientConnection.send({ type: 'authoritative-turn-action', player, action });
      return true;
    },
  };
})();