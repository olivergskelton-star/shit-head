(() => {
  const MP = {
    peer: null,
    role: "local",
    roomCode: "",
    player: "",
    hostConnection: null,
    connections: new Map(),
    claimedPlayers: new Set(),
    suppressPublish: false,
    publishTimer: null,
  };

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function snapshotState() {
    const snap = clone(state);
    delete snap.viewer;
    delete snap.selected;
    return snap;
  }
  function applySnapshot(snap) {
    if (!snap || typeof snap !== "object") return;
    const viewer = state.viewer;
    MP.suppressPublish = true;
    Object.keys(snap).forEach((key) => { state[key] = clone(snap[key]); });
    state.viewer = viewer;
    state.selected = [];
    if (state.theme) {
      themeSelect.value = state.theme;
      document.body.dataset.theme = state.theme;
    }
    render();
    MP.suppressPublish = false;
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
  function updateRoomUi() {
    const online = MP.role !== "local";
    trigger.classList.toggle("online", online);
    trigger.textContent = online ? `Room ${MP.roomCode}` : "Play online";
    roomCard.classList.toggle("multiplayer-hidden", !online);
    roomDisplay.textContent = MP.roomCode;
    const connected = new Set([MP.player]);
    MP.connections.forEach((meta) => { if (meta.player) connected.add(meta.player); });
    if (MP.role === "client" && MP.player) connected.add(MP.player);
    playersEl.replaceChildren(...PLAYER_NAMES.map((name) => {
      const pill = document.createElement("span");
      pill.className = `room-player${connected.has(name) ? " connected" : ""}`;
      pill.textContent = connected.has(name) ? `${name} ✓` : name;
      return pill;
    }));
    roomStatus.textContent = MP.role === "host"
      ? `${MP.player} is hosting. Keep this browser open while you play.`
      : MP.role === "client" ? `Connected as ${MP.player}.` : "";
  }

  function resetOnlineState() {
    try { MP.hostConnection?.close(); } catch (_) {}
    MP.connections.forEach((_, conn) => { try { conn.close(); } catch (_) {} });
    try { MP.peer?.destroy(); } catch (_) {}
    MP.peer = null;
    MP.hostConnection = null;
    MP.connections.clear();
    MP.claimedPlayers.clear();
    MP.role = "local";
    MP.roomCode = "";
    MP.player = "";
    viewerSelect.disabled = false;
    newGameBtn.disabled = false;
    updateRoomUi();
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
        send(conn, { type: "welcome", roomCode: MP.roomCode, player: requested, state: snapshotState() });
        broadcast({ type: "presence", players: [...MP.claimedPlayers] });
        updateRoomUi();
        return;
      }
      if (data.type === "state-proposal") {
        const meta = MP.connections.get(conn);
        if (!meta?.player || meta.player !== data.player) return;
        applySnapshot(data.state);
        broadcast({ type: "state", state: snapshotState() });
      }
    });
    conn.on("close", () => {
      const meta = MP.connections.get(conn);
      if (meta?.player) MP.claimedPlayers.delete(meta.player);
      MP.connections.delete(conn);
      broadcast({ type: "presence", players: [...MP.claimedPlayers] });
      updateRoomUi();
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
    setViewer(player);
    newGameBtn.disabled = false;
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
          applySnapshot(data.state);
          updateRoomUi();
          dialog.close();
        } else if (data.type === "state") {
          applySnapshot(data.state);
        } else if (data.type === "presence") {
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
  dialog.querySelector("#mpCreate").addEventListener("click", createRoom);
  dialog.querySelector("#mpJoin").addEventListener("click", joinRoom);
  dialog.querySelector("#mpClose").addEventListener("click", () => dialog.close());
  roomInput.addEventListener("input", () => { roomInput.value = roomInput.value.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 6); });

  const renderBeforeMultiplayer = render;
  render = function renderWithMultiplayer() {
    renderBeforeMultiplayer();
    schedulePublish();
  };

  window.ShitHeadMultiplayer = {
    publishState,
    disconnect: resetOnlineState,
    get status() { return { role: MP.role, roomCode: MP.roomCode, player: MP.player }; },
  };
})();
