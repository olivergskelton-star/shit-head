(() => {
  const MP = {
    peer: null,
    role: "local",
    roomCode: "",
    player: "",
    hostConnection: null,
    connections: new Map(),
    claimedPlayers: new Set(),
    presentPlayers: new Set(),
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
    const viewer = state.viewer;
    const setupSelection = state.setupSelection;
    MP.suppressPublish = true;
    Object.keys(snap).forEach((key) => { state[key] = clone(snap[key]); });
    state.viewer = viewer;
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
    if (MP.role === "host") broadcast(payload);
    else send(MP.hostConnection, { type: "state-proposal", state: payload.state, player: MP.player });
  }
  function schedulePublish() {
    if (MP.role === "local" || MP.suppressPublish) return;
    clearTimeout(MP.publishTimer);
    MP.publishTimer = setTimeout(publishState, 40);
  }

  function setViewer(player) {
    if (!PLAYER_NAMES.includes(player)) return;
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
      <p>Create a table in one browser, then give the six-character room code to the other two players.</p>
      <div class="multiplayer-grid">
        <label class="multiplayer-field">You are
          <select id="mpPlayer">${PLAYER_NAMES.map((name) => `<option value="${name}">${name}</option>`).join("")}</select>
        </label>
        <label class="multiplayer-field">Room code
          <input id="mpRoomCode" maxlength="6" autocomplete="off" spellcheck="false" placeholder="e.g. WINE42" />
        </label>
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
        <div id="mpPlayers" class="room-players"></div>
      </div>
    </section>`;
  document.body.append(dialog);

  const playerSelect = dialog.querySelector("#mpPlayer");
  const roomInput = dialog.querySelector("#mpRoomCode");
  const errorText = dialog.querySelector("#mpError");
  const roomCard = dialog.querySelector("#mpRoomCard");
  const roomDisplay = dialog.querySelector("#mpRoomDisplay");
  const roomStatus = dialog.querySelector("#mpRoomStatus");
  const playersEl = dialog.querySelector("#mpPlayers");

  function showError(message = "") { errorText.textContent = message; }

  function onlinePlayers() {
    if (MP.role === "host") return new Set(MP.claimedPlayers);
    if (MP.role === "client") return new Set(MP.presentPlayers.size ? MP.presentPlayers : [MP.player]);
    return new Set();
  }

  function updateStartUi() {
    const inLobby = MP.role !== "local" && state.phase === "lobby";
    const connected = onlinePlayers();
    const allThree = PLAYER_NAMES.every((name) => connected.has(name));

    startButton.classList.toggle("multiplayer-hidden", !inLobby);
    if (!inLobby) {
      if (MP.role === "host") newGameBtn.disabled = false;
      else if (MP.role === "client") newGameBtn.disabled = true;
      return;
    }

    newGameBtn.disabled = true;
    if (MP.role === "host") {
      startButton.disabled = !allThree;
      startButton.textContent = allThree ? "START GAME" : `WAITING ${connected.size}/3`;
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

    const connected = onlinePlayers();
    playersEl.replaceChildren(...PLAYER_NAMES.map((name) => {
      const pill = document.createElement("span");
      pill.className = `room-player${connected.has(name) ? " connected" : ""}`;
      pill.textContent = connected.has(name) ? `${name} ✓` : name;
      return pill;
    }));

    if (MP.role === "host") {
      roomStatus.textContent = state.phase === "lobby"
        ? connected.size === 3
          ? "Everyone is in. Close this window and press START GAME."
          : `Waiting for players — ${connected.size}/3 connected.`
        : `${MP.player} is hosting. Keep this browser open while you play.`;
    } else if (MP.role === "client") {
      roomStatus.textContent = state.phase === "lobby"
        ? `Connected as ${MP.player}. Waiting for the host to start.`
        : `Connected as ${MP.player}.`;
    } else roomStatus.textContent = "";

    updateStartUi();
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
    state.lastMessage = "Online table ready — waiting for all three players.";
    if (typeof tickerReset === "function") tickerReset();
    MP.suppressPublish = false;
    render();
  }

  function startOnlineGame() {
    if (MP.role !== "host" || state.phase !== "lobby") return;
    const connected = onlinePlayers();
    if (!PLAYER_NAMES.every((name) => connected.has(name))) {
      state.lastMessage = "All three players need to be connected before the deal starts.";
      render();
      return;
    }

    MP.suppressPublish = true;
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
    try { MP.hostConnection?.close(); } catch (_) {}
    MP.connections.forEach((_, conn) => { try { conn.close(); } catch (_) {} });
    try { MP.peer?.destroy(); } catch (_) {}
    MP.peer = null;
    MP.hostConnection = null;
    MP.connections.clear();
    MP.claimedPlayers.clear();
    MP.presentPlayers.clear();
    MP.role = "local";
    MP.roomCode = "";
    MP.player = "";
    viewerSelect.disabled = false;
    newGameBtn.disabled = false;
    startButton.classList.add("multiplayer-hidden");
    updateRoomUi();
  }

  function publishPresence() {
    const players = [...MP.claimedPlayers];
    MP.presentPlayers = new Set(players);
    broadcast({ type: "presence", players });
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
      } else if (proposed.lastMessage) {
        state.lastMessage = proposed.lastMessage;
      }
    }

    render();
    MP.suppressPublish = false;
    updateRoomUi();
    return true;
  }

  function handleHostConnection(conn) {
    MP.connections.set(conn, { player: null });
    conn.on("data", (data) => {
      if (!data || typeof data !== "object") return;
      if (data.type === "join") {
        const requested = data.player;
        if (!PLAYER_NAMES.includes(requested) || MP.claimedPlayers.has(requested)) {
          send(conn, { type: "rejected", message: `${requested || "That seat"} is already taken.` });
          return;
        }
        MP.connections.get(conn).player = requested;
        MP.claimedPlayers.add(requested);
        MP.presentPlayers = new Set(MP.claimedPlayers);
        send(conn, { type: "welcome", roomCode: MP.roomCode, player: requested, players: [...MP.claimedPlayers], state: snapshotState() });
        publishPresence();
        return;
      }
      if (data.type === "state-proposal") {
        const meta = MP.connections.get(conn);
        if (!meta?.player || meta.player !== data.player) return;

        // Setup is the only phase where multiple players legitimately change
        // state at the same time, so merge by player instead of last-write-wins.
        if (state.phase === "setup" && mergeSetupProposal(meta.player, data.state)) {
          broadcast({ type: "state", state: snapshotState() });
          return;
        }

        applySnapshot(data.state);
        broadcast({ type: "state", state: snapshotState() });
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
    const player = playerSelect.value;
    const code = randomRoomCode();
    MP.role = "host";
    MP.roomCode = code;
    MP.player = player;
    MP.claimedPlayers.add(player);
    MP.presentPlayers = new Set([player]);
    setViewer(player);
    enterOnlineLobby();
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
    MP.player = playerSelect.value;
    MP.presentPlayers = new Set([MP.player]);
    setViewer(MP.player);
    newGameBtn.disabled = true;
    updateRoomUi();
    MP.peer = new Peer();
    MP.peer.on("open", () => {
      const conn = MP.peer.connect(peerIdForRoom(code), { reliable: true });
      MP.hostConnection = conn;
      conn.on("open", () => send(conn, { type: "join", player: MP.player }));
      conn.on("data", (data) => {
        if (!data || typeof data !== "object") return;
        if (data.type === "welcome") {
          setViewer(data.player);
          MP.presentPlayers = new Set(data.players || [data.player]);
          applySnapshot(data.state);
          updateRoomUi();
          dialog.close();
        } else if (data.type === "state") {
          applySnapshot(data.state);
        } else if (data.type === "presence") {
          MP.presentPlayers = new Set(data.players || []);
          updateRoomUi();
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
        ? "Online lobby — wait for all three players, then press START GAME."
        : "Online lobby — waiting for the host to start the deal.";
    }
    updateStartUi();
    schedulePublish();
  };

  window.ShitHeadMultiplayer = {
    publishState,
    disconnect: resetOnlineState,
    startGame: startOnlineGame,
    get status() { return { role: MP.role, roomCode: MP.roomCode, player: MP.player, players: [...onlinePlayers()] }; },
  };
})();
