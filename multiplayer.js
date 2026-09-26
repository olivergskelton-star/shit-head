(() => {
  const ROOM_SEATS = ["Oliver", "Dan", "Chris", "Player 4"];
  const MP = {
    peer: null,
    role: "local",
    roomCode: "",
    player: "",
    displayName: "",
    seatToken: "",
    hostConnection: null,
    connections: new Map(),
    claimedPlayers: new Set(),
    presentPlayers: new Set(),
    seatTokens: new Map(),
    suppressPublish: false,
    publishTimer: null,
  };

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function snapshotState() {
    const snap = clone(state);
    delete snap.viewer;
    delete snap.selected;
    // Setup selection is private UI state. Sharing it makes one player's
    // half-completed swap appear on another player's browser.
    delete snap.setupSelection;
    return snap;
  }
  function applySnapshot(snap) {
    if (!snap || typeof snap !== "object") return;
    const roster = Array.isArray(snap.playerOrder) && snap.playerOrder.length
      ? snap.playerOrder
      : Object.keys(snap.players || {});
    if (roster.length) setPlayerRoster(roster);
    // A client is permanently tied to the anonymous seat issued by the host.
    // Snapshots intentionally omit `viewer`, so never let a default/local viewer
    // leak back in when a four-seat room is synchronised.
    const viewer = MP.role === "client" && MP.player ? MP.player : state.viewer;
    const setupSelection = state.setupSelection;
    MP.suppressPublish = true;
    Object.keys(snap).forEach((key) => { state[key] = clone(snap[key]); });
    state.viewer = viewer;
    viewerSelect.value = viewer;
    state.selected = [];
    state.setupSelection = state.phase === "setup" ? setupSelection : null;
    if (state.theme) {
      themeSelect.value = state.theme;
      document.body.dataset.theme = state.theme;
    }
    render();
    MP.suppressPublish = false;
    updateRoomUi();
  }

  function send(conn, payload) {
    if (conn && conn.open) conn.send(payload);
  }
  function broadcast(payload, except = null) {
    MP.connections.forEach((meta, conn) => {
      if (conn !== except) send(conn, payload);
    });
  }
  function publishState() {
    if (MP.role === "local" || MP.suppressPublish) return;
    const payload = { type: "state", state: snapshotState() };
    if (MP.role === "host") {
      broadcast(payload);
      return;
    }
    // Whole-state proposals are ONLY used while players concurrently arrange
    // their setup cards. Once play starts, clients send explicit actions instead.
    if (state.phase === "setup") {
      send(MP.hostConnection, { type: "state-proposal", state: payload.state, player: MP.player });
    }
  }
  function schedulePublish() {
    if (MP.role === "local" || MP.suppressPublish) return;
    clearTimeout(MP.publishTimer);
    MP.publishTimer = setTimeout(publishState, 40);
  }

  function sendAction(action) {
    if (MP.role !== "client" || !MP.hostConnection?.open || !action || typeof action !== "object") return false;
    send(MP.hostConnection, { type: "action", player: MP.player, action: clone(action) });
    return true;
  }

  // Reactions are fixed, transient messages, never game-state proposals. The
  // host binds each one to the authenticated connection's seat and rate limits it.
  const reactionTimes = new Map();
  function acceptReaction(player, reaction) {
    if (!['play', 'gameover'].includes(state.phase) || !PLAYER_NAMES.includes(player)
      || !window.ShitHeadTableSocial?.isReaction(reaction)) return false;
    const now = Date.now();
    if (now - (reactionTimes.get(player) || 0) < 2000) return false;
    reactionTimes.set(player, now);
    window.ShitHeadTableSocial.receiveReaction(player, reaction);
    broadcast({ type: 'reaction', player, reaction });
    return true;
  }
  function sendReaction(reaction) {
    if (!window.ShitHeadTableSocial?.isReaction(reaction)) return false;
    if (MP.role === 'host') return acceptReaction(MP.player, reaction);
    if (MP.role !== 'client' || !MP.hostConnection?.open) return false;
    send(MP.hostConnection, { type: 'reaction', player: MP.player, reaction });
    return true;
  }

  function setViewer(player) {
    if (!PLAYER_NAMES.includes(player)) {
      if (!ROOM_SEATS.includes(player)) return;
      setPlayerRoster([...PLAYER_NAMES, player]);
    }
    state.viewer = player;
    viewerSelect.value = player;
    viewerSelect.disabled = true;
    state.selected = [];
  }

  function randomRoomCode() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let out = "";
    for (let i = 0; i < 6; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
    return out;
  }
  function peerIdForRoom(code) { return `shithead-${code.toLowerCase()}`; }
  function cleanDisplayName(value, fallback = "Player") {
    return String(value || fallback).trim().replace(/\s+/g, " ").slice(0, 24) || fallback;
  }
  function randomToken() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let out = "";
    for (let i = 0; i < 8; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
    return out;
  }
  function rejoinLink(code, pin) {
    if (!code || !pin) return "";
    return `${location.origin}${location.pathname}?room=${encodeURIComponent(code)}&pin=${encodeURIComponent(pin)}`;
  }
  function preferredSeat() {
    return ROOM_SEATS.includes(playerSelect.value) ? playerSelect.value : "";
  }
  function enteredDisplayName() {
    const name = cleanDisplayName(displayNameInput.value || "Player");
    try { localStorage.setItem('shithead-player-name', name); } catch {}
    return name;
  }
  function enteredPin() {
    return String(rejoinPinInput.value || "").trim().toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 8);
  }

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "multiplayer-trigger";
  trigger.textContent = "Play online";
  document.querySelector(".controls")?.prepend(trigger);

  const startButton = document.createElement("button");
  startButton.type = "button";
  startButton.className = "multiplayer-start multiplayer-hidden";
  startButton.textContent = "START GAME";
  trigger.insertAdjacentElement("afterend", startButton);

  const dialog = document.createElement("dialog");
  dialog.className = "multiplayer-dialog";
  dialog.innerHTML = `
    <section class="multiplayer-sheet">
      <h2>Play together</h2>
      <p>Create a table in one browser, then share the room code with up to three other players.</p>
      <div class="multiplayer-grid">
        <label class="multiplayer-field">Your display name
          <input id="mpDisplayName" maxlength="24" autocomplete="nickname" spellcheck="false" placeholder="e.g. Oliver" />
        </label>
        <label class="multiplayer-field">Room code
          <input id="mpRoomCode" maxlength="6" autocomplete="off" spellcheck="false" placeholder="e.g. WINE42" />
        </label>
        <details class="multiplayer-advanced"><summary>Rejoin or choose a seat</summary>
        <label class="multiplayer-field">Seat preference <span class="field-note">optional</span>
          <select id="mpPlayer"><option value="">Any open seat</option>${ROOM_SEATS.map((name, index) => `<option value="${name}">Seat ${index + 1}</option>`).join("")}</select>
        </label>
        <label class="multiplayer-field">Rejoin PIN <span class="field-note">optional</span>
          <input id="mpRejoinPin" maxlength="8" autocomplete="one-time-code" spellcheck="false" placeholder="For another device" />
        </label>
        </details>
        <p id="mpError" class="multiplayer-error"></p>
        <div class="multiplayer-actions">
          <button id="mpCreate" class="multiplayer-create" type="button">Create game</button>
          <button id="mpJoin" class="multiplayer-join" type="button">Join game</button>
          <button id="mpClose" class="multiplayer-close" type="button">Close</button>
        </div>
      </div>
      <div id="mpRoomCard" class="room-card multiplayer-hidden">
        <div>ROOM</div>
        <div id="mpRoomDisplay" class="room-code"></div>
        <p id="mpRoomStatus" class="room-status"></p>
        <div class="room-invite"><button id="mpCopyInvite" type="button">Copy invite link</button><input id="mpInviteLink" aria-label="Guest invite link" readonly /><span id="mpInviteStatus" role="status"></span></div>
        <p id="mpRejoinInfo" class="room-rejoin-info"></p>
        <div id="mpPlayers" class="room-players"></div>
      </div>
    </section>`;
  document.body.append(dialog);

  const playerSelect = dialog.querySelector("#mpPlayer");
  const displayNameInput = dialog.querySelector("#mpDisplayName");
  const roomInput = dialog.querySelector("#mpRoomCode");
  const rejoinPinInput = dialog.querySelector("#mpRejoinPin");
  const errorText = dialog.querySelector("#mpError");
  const roomCard = dialog.querySelector("#mpRoomCard");
  const roomDisplay = dialog.querySelector("#mpRoomDisplay");
  const roomStatus = dialog.querySelector("#mpRoomStatus");
  const rejoinInfo = dialog.querySelector("#mpRejoinInfo");
  const playersEl = dialog.querySelector("#mpPlayers");
  const inviteLink = dialog.querySelector('#mpInviteLink');
  try { displayNameInput.value = localStorage.getItem('shithead-player-name') || ''; } catch {}
  dialog.querySelector('#mpCopyInvite').onclick = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink.value);
      dialog.querySelector('#mpInviteStatus').textContent = 'Invite link copied — share it with your friends.';
    } catch {
      inviteLink.focus(); inviteLink.select();
      dialog.querySelector('#mpInviteStatus').textContent = 'Select and copy this invite link.';
    }
  };

  // A rejoin link carries no account credentials; it only pre-fills the room
  // code and seat PIN that the host already issued for this anonymous seat.
  const urlParams = new URLSearchParams(location.search);
  const linkedRoom = String(urlParams.get("room") || "").toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 6);
  const linkedPin = String(urlParams.get("pin") || "").toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 8);
  if (linkedRoom) roomInput.value = linkedRoom;
  if (linkedPin) rejoinPinInput.value = linkedPin;
  if (linkedPin) dialog.querySelector('.multiplayer-advanced').open = true;
  if (linkedRoom && !displayNameInput.value) {
    try {
      const saved = JSON.parse(localStorage.getItem(`shithead-rejoin-${linkedRoom}`) || "null");
      if (saved?.displayName) displayNameInput.value = saved.displayName;
      if (!rejoinPinInput.value && saved?.pin) rejoinPinInput.value = saved.pin;
      if (saved?.seat && ROOM_SEATS.includes(saved.seat)) playerSelect.value = saved.seat;
    } catch (_) {}
  }

  function showError(message = "") { errorText.textContent = message; }

  function onlinePlayers() {
    if (MP.role === "host") return new Set(MP.claimedPlayers);
    if (MP.role === "client") return new Set(MP.presentPlayers.size ? MP.presentPlayers : [MP.player]);
    return new Set();
  }

  function updateStartUi() {
    const inLobby = MP.role !== "local" && state.phase === "lobby";
    const connected = onlinePlayers();
    const canStart = MP.role === "host" && connected.size >= 1 && connected.size <= ROOM_SEATS.length;

    startButton.classList.toggle("multiplayer-hidden", !inLobby);
    if (!inLobby) {
      if (MP.role === "host") newGameBtn.disabled = false;
      else if (MP.role === "client") newGameBtn.disabled = true;
      return;
    }

    newGameBtn.disabled = true;
    if (MP.role === "host") {
      startButton.disabled = !canStart;
      startButton.textContent = canStart ? `START GAME · ${connected.size} PLAYER${connected.size === 1 ? "" : "S"}` : "WAITING FOR HOST";
    } else {
      startButton.disabled = true;
      startButton.textContent = "WAITING FOR HOST";
    }
  }

  function updateRoomUi() {
    const online = MP.role !== "local";
    trigger.classList.toggle("online", online);
    trigger.textContent = online ? `Room ${MP.roomCode}` : "Play online";
    roomCard.classList.toggle("multiplayer-hidden", !online);
    roomDisplay.textContent = MP.roomCode;
    inviteLink.value = MP.roomCode ? `${location.origin}${location.pathname}?room=${encodeURIComponent(MP.roomCode)}` : '';

    const connected = onlinePlayers();
    playersEl.replaceChildren(...ROOM_SEATS.map((name) => {
      const pill = document.createElement("span");
      pill.className = `room-player${connected.has(name) ? " connected" : ""}`;
      const label = publicName(name);
      pill.textContent = connected.has(name) ? `${label} ✓` : "Open seat";
      return pill;
    }));

    if (MP.role === "host") {
      roomStatus.textContent = state.phase === "lobby"
        ? connected.size >= 1
          ? `${connected.size} player${connected.size === 1 ? "" : "s"} connected. Add more or start the game.`
          : "Waiting for the first player."
        : `${publicName(MP.player)} is hosting. Keep this browser open while you play.`;
    } else if (MP.role === "client") {
      roomStatus.textContent = state.phase === "lobby"
        ? `Connected as ${publicName(MP.player)}. Waiting for the host to start.`
        : `Connected as ${publicName(MP.player)}.`;
    } else roomStatus.textContent = "";

    if (rejoinInfo) {
      rejoinInfo.replaceChildren();
      if (MP.seatToken) {
        const copy = document.createElement("span");
        copy.textContent = `Your rejoin PIN: ${MP.seatToken} · use it with this room code on another device. `;
        const link = document.createElement("a");
        link.href = rejoinLink(MP.roomCode, MP.seatToken);
        link.textContent = "Open your rejoin link";
        link.target = "_blank";
        link.rel = "noopener";
        rejoinInfo.append(copy, link);
      }
    }

    updateStartUi();
    window.ShitHeadTableSocial?.refresh();
  }

  function blankPlayers() {
    return Object.fromEntries(PLAYER_NAMES.map((name) => [name, { faceDown: [], faceUp: [], hand: [] }]));
  }

  function enterOnlineLobby() {
    MP.suppressPublish = true;
    state.phase = "lobby";
    state.players = blankPlayers();
    state.drawPile = [];
    state.discard = [];
    state.burnPile = [];
    state.followUpRank = null;
    state.setupReady = Object.fromEntries(PLAYER_NAMES.map((name) => [name, false]));
    state.setupReadyOrder = [];
    state.setupSelection = null;
    state.startingPlayer = null;
    state.currentPlayer = null;
    state.selected = [];
    state.lastMessage = "Online table ready — add players or start when ready.";
    if (typeof tickerReset === "function") tickerReset();
    MP.suppressPublish = false;
    render();
  }

  function startOnlineGame() {
    if (MP.role !== "host" || state.phase !== "lobby") return;
    const connected = onlinePlayers();
    const activePlayers = ROOM_SEATS.filter((name) => connected.has(name));
    if (!activePlayers.length) {
      state.lastMessage = "At least one player must be connected before the deal starts.";
      render();
      return;
    }

    MP.suppressPublish = true;
    setPlayerRoster(activePlayers);
    state.scores = Object.fromEntries(activePlayers.map((name) => [name, 0]));
    dealNewGame();
    if (typeof resetSetupPhase === "function") resetSetupPhase();
    state.phase = "setup";
    state.currentPlayer = null;
    state.startingPlayer = null;
    state.lastMessage = "Cards dealt — arrange your face-up table cards, then press READY.";
    if (typeof tickerReset === "function") tickerReset();
    MP.suppressPublish = false;
    render();
    publishState();
  }

  function resetOnlineState() {
    reactionTimes.clear();
    window.ShitHeadTableSocial?.clear();
    try { MP.hostConnection?.close(); } catch (_) {}
    MP.connections.forEach((_, conn) => { try { conn.close(); } catch (_) {} });
    try { MP.peer?.destroy(); } catch (_) {}
    MP.peer = null;
    MP.hostConnection = null;
    MP.connections.clear();
    MP.claimedPlayers.clear();
    MP.presentPlayers.clear();
    MP.seatTokens.clear();
    MP.role = "local";
    MP.roomCode = "";
    MP.player = "";
    MP.displayName = "";
    MP.seatToken = "";
    setPlayerRoster(DEFAULT_PLAYER_NAMES);
    viewerSelect.disabled = false;
    newGameBtn.disabled = false;
    startButton.classList.add("multiplayer-hidden");
    updateRoomUi();
  }

  function publishPresence() {
    const players = [...MP.claimedPlayers];
    MP.presentPlayers = new Set(players);
    broadcast({ type: "presence", players, displayNames: state.displayNames });
    updateRoomUi();
  }

  function finishSetupOnHostIfReady() {
    if (state.phase !== "setup" || !PLAYER_NAMES.every((name) => state.setupReady?.[name])) return false;
    if (typeof determineStartingPlayer !== "function") return false;

    const start = determineStartingPlayer();
    state.phase = "play";
    state.startingPlayer = start.name;
    state.currentPlayer = start.name;
    state.setupSelection = null;

    const tied = start.holders.length > 1;
    state.lastMessage = start.rank
      ? tied
        ? `${publicName(start.name)} starts with the lowest hand card (${start.rank}); READY order broke the tie.`
        : `${publicName(start.name)} starts with the lowest hand card (${start.rank}).`
      : `${publicName(start.name)} starts.`;
    return true;
  }

  function mergeSetupProposal(player, proposed) {
    if (!proposed || !proposed.players?.[player] || state.phase !== "setup") return false;

    MP.suppressPublish = true;
    // During setup players act concurrently. Only accept this browser's own
    // hand/table and ready flag; never replace the other two players' setup.
    state.players[player] = clone(proposed.players[player]);
    if (proposed.displayNames?.[player]) state.displayNames[player] = proposed.displayNames[player];

    const wasReady = !!state.setupReady?.[player];
    const isReady = !!proposed.setupReady?.[player];
    if (isReady && !wasReady) {
      state.setupReady[player] = true;
      if (!state.setupReadyOrder.includes(player)) state.setupReadyOrder.push(player);
    }

    if (!finishSetupOnHostIfReady()) {
      if (isReady && !wasReady) {
        const waiting = PLAYER_NAMES.filter((name) => !state.setupReady[name]).map(publicName);
        state.lastMessage = `${publicName(player)} is ready. Waiting for ${waiting.join(" and ")}.`;
      } else {
        // Setup proposals contain private hand choices. Publish only the fact
        // that the player is arranging their cards, never the selected ranks.
        state.lastMessage = `${publicName(player)} is arranging their cards.`;
      }
    }

    render();
    MP.suppressPublish = false;
    updateRoomUi();
    return true;
  }

  function cleanActionRefs(refs) {
    if (!Array.isArray(refs)) return [];
    return refs
      .filter((ref) => ref && (ref.zone === "hand" || ref.zone === "faceUp") && Number.isInteger(ref.index))
      .map((ref) => ({ zone: ref.zone, index: ref.index }));
  }

  function executeHostAction(player, action) {
    if (!action || typeof action !== "object") return false;

    if (action.type === "reveal-shithead") {
      return window.ShitHeadTablePlay?.revealShitHeadCards?.(player) === true;
    }

    if (state.phase !== "play") return false;

    // Sorting changes only card order, not turn/game rules, so players may sort
    // their own hand at any point during play.
    if (action.type === "sort") {
      if (typeof sortHandFor !== "function") return false;
      sortHandFor(player);
      return true;
    }

    if (state.currentPlayer !== player) return false;

    if (action.type === "play") {
      const refs = cleanActionRefs(action.refs);
      if (!refs.length || !window.ShitHeadTablePlay?.playRefs) return false;
      return window.ShitHeadTablePlay.playRefs(player, refs) !== false;
    }

    if (action.type === "blind") {
      const slotIndex = Number(action.slotIndex);
      if (!Number.isInteger(slotIndex) || !window.ShitHeadTablePlay?.playFaceDown) return false;
      return window.ShitHeadTablePlay.playFaceDown(player, slotIndex) !== false;
    }

    if (action.type === "pickup") {
      if (typeof pickupDiscard !== "function") return false;
      pickupDiscard(player);
      return true;
    }

    if (action.type === "table-pickup") {
      const refs = cleanActionRefs(action.refs);
      if (!refs.length || !window.ShitHeadTablePlay?.pickupTableAndDiscard) return false;
      return window.ShitHeadTablePlay.pickupTableAndDiscard(player, refs) === true;
    }

    if (action.type === "finish") {
      if (typeof finishTurn !== "function") return false;
      finishTurn(player);
      return true;
    }

    return false;
  }

  function handleHostConnection(conn) {
    MP.connections.set(conn, { player: null });
    conn.on("data", (data) => {
      if (!data || typeof data !== "object") return;
      if (data.type === "join") {
        const requested = ROOM_SEATS.includes(data.player) ? data.player : "";
        const suppliedPin = String(data.rejoinPin || "").toUpperCase();
        const tokenSeat = ROOM_SEATS.find((seat) => MP.seatTokens.get(seat) === suppliedPin);
        const requestedSeat = tokenSeat || requested || ROOM_SEATS.find((seat) => !MP.claimedPlayers.has(seat));
        const reconnecting = !!tokenSeat;
        if (!requestedSeat || MP.claimedPlayers.has(requestedSeat) || (!reconnecting && state.phase !== "lobby")) {
          send(conn, { type: "rejected", message: reconnecting ? "That seat is already connected." : "The game has started. Use your rejoin PIN to reclaim your seat." });
          return;
        }
        const pin = MP.seatTokens.get(requestedSeat) || randomToken();
        MP.seatTokens.set(requestedSeat, pin);
        const displayName = cleanDisplayName(data.displayName, state.displayNames?.[requestedSeat] || requestedSeat);
        MP.connections.get(conn).player = requestedSeat;
        MP.claimedPlayers.add(requestedSeat);
        state.displayNames[requestedSeat] = displayName;
        MP.presentPlayers = new Set(MP.claimedPlayers);
        send(conn, {
          type: "welcome",
          roomCode: MP.roomCode,
          player: requestedSeat,
          displayName,
          rejoinPin: pin,
          players: [...MP.claimedPlayers],
          displayNames: state.displayNames,
          state: snapshotState(),
        });
        publishPresence();
        return;
      }

      const meta = MP.connections.get(conn);
      if (!meta?.player || meta.player !== data.player) return;

      if (data.type === 'reaction') {
        acceptReaction(meta.player, data.reaction);
        return;
      }

        if (data.type === "action") {
        MP.suppressPublish = true;
        let accepted = false;
        try {
          accepted = executeHostAction(meta.player, data.action);
        } finally {
          MP.suppressPublish = false;
        }
        send(conn, { type: "action-result", ok: accepted });
        publishState();
        return;
      }

      if (data.type === "state-proposal") {
        // Setup is the ONLY phase where client state is merged. Ignore any stale
        // proposal that arrives after play has begun or the game has ended.
        if (state.phase !== "setup") return;
        if (mergeSetupProposal(meta.player, data.state)) {
          broadcast({ type: "state", state: snapshotState() });
        }
      }
    });
    conn.on("close", () => {
      const meta = MP.connections.get(conn);
      if (meta?.player) MP.claimedPlayers.delete(meta.player);
      MP.connections.delete(conn);
      publishPresence();
    });
  }

  function createRoom() {
    showError();
    if (typeof Peer === "undefined") { showError("Online library did not load. Check your internet connection and refresh."); return; }
    resetOnlineState();
    const player = preferredSeat() || ROOM_SEATS[0];
    const code = randomRoomCode();
    MP.role = "host";
    MP.roomCode = code;
    MP.player = player;
    MP.displayName = enteredDisplayName();
    MP.seatToken = randomToken();
    MP.seatTokens.set(player, MP.seatToken);
    MP.claimedPlayers.add(player);
    MP.presentPlayers = new Set([player]);
    setViewer(player);
    enterOnlineLobby();
    state.displayNames[player] = MP.displayName;
    try {
      localStorage.setItem(`shithead-rejoin-${code}`, JSON.stringify({ roomCode: code, pin: MP.seatToken, displayName: MP.displayName, seat: MP.player }));
    } catch (_) {}
    updateRoomUi();
    MP.peer = new Peer(peerIdForRoom(code));
    MP.peer.on("open", () => {
      updateRoomUi();
      publishState();
    });
    MP.peer.on("connection", handleHostConnection);
    MP.peer.on("error", (err) => {
      showError(err?.type === "unavailable-id" ? "That room code collided. Close and create another room." : "Could not create the room. Try again.");
    });
  }

  function joinRoom() {
    showError();
    if (typeof Peer === "undefined") { showError("Online library did not load. Check your internet connection and refresh."); return; }
    const code = roomInput.value.trim().toUpperCase();
    if (code.length !== 6) { showError("Enter the six-character room code."); return; }
    resetOnlineState();
    MP.role = "client";
    MP.roomCode = code;
    MP.displayName = enteredDisplayName();
    MP.seatToken = enteredPin();
    MP.player = preferredSeat();
    MP.presentPlayers = new Set();
    newGameBtn.disabled = true;
    updateRoomUi();
    MP.peer = new Peer();
    MP.peer.on("open", () => {
      const conn = MP.peer.connect(peerIdForRoom(code), { reliable: true });
      MP.hostConnection = conn;
      conn.on("open", () => send(conn, {
        type: "join",
        player: MP.player,
        displayName: MP.displayName,
        rejoinPin: MP.seatToken,
      }));
      conn.on("data", (data) => {
        if (!data || typeof data !== "object") return;
        if (data.type === "welcome") {
          setViewer(data.player);
          MP.player = data.player;
          MP.displayName = data.displayName || MP.displayName;
          MP.seatToken = data.rejoinPin || MP.seatToken;
          state.displayNames[data.player] = MP.displayName;
          MP.presentPlayers = new Set(data.players || [data.player]);
          if (data.displayNames) state.displayNames = clone(data.displayNames);
          applySnapshot(data.state);
          try {
            localStorage.setItem(`shithead-rejoin-${data.roomCode}`, JSON.stringify({ roomCode: data.roomCode, pin: MP.seatToken, displayName: MP.displayName, seat: MP.player }));
          } catch (_) {}
          updateRoomUi();
          dialog.close();
        } else if (data.type === "state") {
          applySnapshot(data.state);
        } else if (data.type === 'reaction') {
          window.ShitHeadTableSocial?.receiveReaction(data.player, data.reaction);
        } else if (data.type === "presence") {
          MP.presentPlayers = new Set(data.players || []);
          if (data.displayNames) state.displayNames = clone(data.displayNames);
          updateRoomUi();
        } else if (data.type === "action-result" && data.ok === false) {
          statusText.textContent = "The host rejected that action. The table has been resynchronised.";
        } else if (data.type === "rejected") {
          showError(data.message || "Could not join that seat.");
          resetOnlineState();
        }
      });
      conn.on("close", () => {
        showError("Connection to the host was lost.");
        resetOnlineState();
        dialog.showModal();
      });
    });
    MP.peer.on("error", () => { showError("Could not join that room. Check the code and try again."); });
  }

  trigger.addEventListener("click", () => { showError(); updateRoomUi(); dialog.showModal(); });
  startButton.addEventListener("click", startOnlineGame);
  dialog.querySelector("#mpCreate").addEventListener("click", createRoom);
  dialog.querySelector("#mpJoin").addEventListener("click", joinRoom);
  dialog.querySelector("#mpClose").addEventListener("click", () => dialog.close());
  roomInput.addEventListener("input", () => { roomInput.value = roomInput.value.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 6); });

  const renderBeforeMultiplayer = render;
  render = function renderWithMultiplayer() {
    renderBeforeMultiplayer();
    if (MP.role !== "local" && state.phase === "lobby") {
      statusText.textContent = MP.role === "host"
        ? "Online lobby — add players or press START GAME when ready."
        : "Online lobby — waiting for the host to start the deal.";
    }
    updateStartUi();
    schedulePublish();
  };

  window.ShitHeadMultiplayer = {
    publishState,
    sendAction,
    sendReaction,
    disconnect: resetOnlineState,
    startGame: startOnlineGame,
    get status() { return { role: MP.role, roomCode: MP.roomCode, player: MP.player, players: [...onlinePlayers()] }; },
  };
  if (linkedRoom) dialog.showModal();
})();
