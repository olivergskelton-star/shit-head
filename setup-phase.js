// Setup phase: each player may swap hand cards with their 3 face-up table cards before play.
// Loaded after engine-v2.js. In local mode, use View As to configure each player and mark them READY.

// Opening-only order. A, 2 and 3 are high/special and do not qualify as the
// lowest opening card. 4 is therefore the lowest possible opener.
const STARTING_RANK_ORDER = ["4", "5", "6", "7", "8", "9", "J", "Q", "K", "10"];

state.phase = "setup";
state.setupReady = Object.fromEntries(PLAYER_NAMES.map((name) => [name, false]));
state.setupReadyOrder = [];
state.setupSelection = null;
state.startingPlayer = null;
state.currentPlayer = null;

function setupMultiplayerRole() {
  return window.ShitHeadMultiplayer?.status?.role || "local";
}

function publishClientSetupNow() {
  if (setupMultiplayerRole() !== "client" || state.phase !== "setup") return;
  window.ShitHeadMultiplayer?.publishState?.();
}

function ensureOpeningHandsOfFour() {
  PLAYER_NAMES.forEach((name) => {
    const hand = state.players[name]?.hand;
    if (!hand) return;
    while (hand.length < 4 && state.drawPile.length > 0) hand.push(state.drawPile.pop());
  });
}

function resetSetupPhase() {
  ensureOpeningHandsOfFour();
  state.phase = "setup";
  state.setupReady = Object.fromEntries(PLAYER_NAMES.map((name) => [name, false]));
  state.setupReadyOrder = [];
  state.setupSelection = null;
  state.startingPlayer = null;
  // Nobody is the active player while cards are still being arranged. The starter
  // is chosen from the FINAL hands only after everybody has pressed READY.
  state.currentPlayer = null;
  state.followUpRank = null;
  state.selected = [];
}

function setupAllReady() {
  return PLAYER_NAMES.every((name) => state.setupReady[name]);
}

function determineStartingPlayer() {
  for (const rank of STARTING_RANK_ORDER) {
    const holders = PLAYER_NAMES.filter((name) =>
      state.players[name]?.hand.some((card) => card.rank === rank)
    );
    if (!holders.length) continue;

    const winner = state.setupReadyOrder.find((name) => holders.includes(name)) || holders[0];
    return { name: winner, rank, holders };
  }

  return { name: state.setupReadyOrder[0] || PLAYER_NAMES[0], rank: null, holders: [] };
}

function selectSetupCard(name, zone, index) {
  if (state.phase !== "setup" || name !== state.viewer || state.setupReady[name]) return;
  const player = state.players[name];
  const source = zone === "hand" ? player.hand : player.faceUp;
  if (!source[index]) return;

  const chosen = state.setupSelection;
  if (!chosen) {
    state.setupSelection = { zone, index };
    state.lastMessage = zone === "hand"
      ? `Selected ${cardText(source[index])} from your hand — choose a face-up table card to swap.`
      : `Selected ${cardText(source[index])} from your table — choose a hand card to swap.`;
    render();
    return;
  }

  if (chosen.zone === zone) {
    state.setupSelection = { zone, index };
    state.lastMessage = zone === "hand"
      ? `Selected ${cardText(source[index])} from your hand — choose a face-up table card to swap.`
      : `Selected ${cardText(source[index])} from your table — choose a hand card to swap.`;
    render();
    return;
  }

  const handIndex = zone === "hand" ? index : chosen.index;
  const tableIndex = zone === "table" ? index : chosen.index;
  const handCard = player.hand[handIndex];
  const tableCard = player.faceUp[tableIndex];
  if (!handCard || !tableCard) return;

  player.hand[handIndex] = tableCard;
  player.faceUp[tableIndex] = handCard;
  state.setupSelection = null;
  state.lastMessage = `${publicName(name)} swapped ${cardText(handCard)} with ${cardText(tableCard)}.`;
  render();
  // Setup mutations are the one place clients still propose their own seat state.
  // Send immediately so another browser render cannot overwrite the swap first.
  publishClientSetupNow();
}

function markSetupReady(name) {
  if (state.phase !== "setup" || name !== state.viewer || state.setupReady[name]) return;
  state.setupReady[name] = true;
  if (!state.setupReadyOrder.includes(name)) state.setupReadyOrder.push(name);
  state.setupSelection = null;

  // A client must NEVER promote itself into PLAY. In the previous build the third
  // client locally saw all three READY flags, switched to play, and therefore no
  // longer sent its setup proposal. The host and clients then ran different phases.
  // Keep the client in setup, send READY immediately, and wait for the host's
  // canonical play snapshot.
  if (setupMultiplayerRole() === "client") {
    state.lastMessage = `${publicName(name)} is ready — waiting for the host to confirm the start.`;
    render();
    publishClientSetupNow();
    return;
  }

  if (setupAllReady()) {
    const start = determineStartingPlayer();
    state.phase = "play";
    state.startingPlayer = start.name;
    state.currentPlayer = start.name;

    const tied = start.holders.length > 1;
    state.lastMessage = start.rank
      ? tied
        ? `${publicName(start.name)} starts with the lowest rank (${start.rank}); READY order broke the tie.`
        : `${publicName(start.name)} starts — they hold the lowest rank (${start.rank}).`
      : `${publicName(start.name)} starts.`;
  } else {
    const waiting = PLAYER_NAMES.filter((playerName) => !state.setupReady[playerName]).map(publicName);
    state.lastMessage = `${publicName(name)} is ready. Waiting for ${waiting.join(" and ")}.`;
  }
  render();
}

function decorateSetupCards() {
  if (state.phase !== "setup") return;
  const self = state.viewer;
  const ready = state.setupReady[self];

  const handCards = [...playerSeat.querySelectorAll(".hand button.card")];
  handCards.forEach((cardEl, index) => {
    cardEl.dataset.setupZone = "hand";
    cardEl.dataset.setupIndex = index;
    cardEl.classList.toggle("setup-selected", !!state.setupSelection && state.setupSelection.zone === "hand" && state.setupSelection.index === index);
    cardEl.disabled = ready;
  });

  const tableStacks = [...playerSeat.querySelectorAll(".self-face-row .face-stack")];
  tableStacks.forEach((stack, index) => {
    stack.dataset.setupZone = "table";
    stack.dataset.setupIndex = index;
    const faceUp = stack.querySelector(".card:not(.card-back)");
    if (!faceUp) return;
    faceUp.classList.add("setup-table-card");
    faceUp.classList.toggle("setup-selected", !!state.setupSelection && state.setupSelection.zone === "table" && state.setupSelection.index === index);
  });
}

function renderSetupActions() {
  if (state.phase !== "setup") return;
  const actions = playerSeat.querySelector(".play-actions");
  if (!actions) return;

  actions.replaceChildren();
  actions.classList.add("visible", "setup-actions");

  const ready = document.createElement("button");
  ready.type = "button";
  ready.className = "setup-ready";
  ready.textContent = state.setupReady[state.viewer] ? "READY ✓" : "READY";
  ready.disabled = state.setupReady[state.viewer];
  ready.addEventListener("click", () => markSetupReady(state.viewer));
  actions.append(ready);

  const hint = document.createElement("span");
  hint.className = "setup-hint";
  hint.textContent = state.setupReady[state.viewer]
    ? `Ready #${state.setupReadyOrder.indexOf(state.viewer) + 1}. Waiting for the others.`
    : `Opening hand: ${state.players[state.viewer].hand.length} cards. Click a hand card, then click a face-up table card to swap. Repeat as needed, then press READY.`;
  actions.append(hint);
}

function renderSetupStatus() {
  if (state.phase !== "setup") return;
  const readyNames = state.setupReadyOrder.map(publicName);
  if (state.lastMessage) {
    statusText.textContent = state.lastMessage;
  } else if (state.setupReady[state.viewer]) {
    statusText.textContent = `Setup — ready order: ${readyNames.join(" → ")}. Waiting for the other players.`;
  } else {
    statusText.textContent = `Setup — ${state.players[state.viewer].hand.length} cards in hand. Arrange your face-up table cards, then press READY.`;
  }
}

// Capture setup clicks before the normal hand-card play handlers run.
playerSeat.addEventListener("click", (event) => {
  if (state.phase !== "setup") return;
  const target = event.target.closest("[data-setup-zone]");
  if (!target) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  selectSetupCard(state.viewer, target.dataset.setupZone, Number(target.dataset.setupIndex));
}, true);

// Prevent draw pile interaction during setup.
drawPileButton.addEventListener("click", (event) => {
  if (state.phase !== "setup") return;
  event.preventDefault();
  event.stopImmediatePropagation();
  state.lastMessage = "Finish arranging the face-up table cards first.";
  render();
}, true);

const renderEngineV2 = render;
render = function renderSetupPhase() {
  renderEngineV2();
  if (state.phase === "setup") {
    decorateSetupCards();
    renderSetupActions();
    renderSetupStatus();
    document.body.dataset.gamePhase = "setup";
  } else if (state.phase === "play") {
    document.body.dataset.gamePhase = "play";
  } else {
    document.body.dataset.gamePhase = state.phase || "lobby";
  }
};

newGameBtn.addEventListener("click", () => {
  resetSetupPhase();
  render();
});

resetSetupPhase();
render();