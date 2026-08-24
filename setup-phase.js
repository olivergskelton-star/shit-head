// Setup phase: each player may swap hand cards with their 3 face-up table cards before play.
// Loaded after engine-v2.js. In the current single-browser test harness, use View As
// to configure each player and mark them READY.

state.phase = "setup";
state.setupReady = Object.fromEntries(PLAYER_NAMES.map((name) => [name, false]));
state.setupSelection = null;
state.startingPlayer = state.currentPlayer;

function resetSetupPhase() {
  state.phase = "setup";
  state.setupReady = Object.fromEntries(PLAYER_NAMES.map((name) => [name, false]));
  state.setupSelection = null;
  state.startingPlayer = state.currentPlayer;
  state.followUpRank = null;
  state.selected = [];
}

function setupAllReady() {
  return PLAYER_NAMES.every((name) => state.setupReady[name]);
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
}

function markSetupReady(name) {
  if (state.phase !== "setup" || name !== state.viewer) return;
  state.setupReady[name] = true;
  state.setupSelection = null;

  if (setupAllReady()) {
    state.phase = "play";
    state.currentPlayer = state.startingPlayer;
    state.lastMessage = `Everyone is ready — ${publicName(state.currentPlayer)} starts.`;
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
    ? "Waiting for the others"
    : "Click a hand card, then click a face-up table card to swap. Repeat as needed, then press READY.";
  actions.append(hint);
}

function renderSetupStatus() {
  if (state.phase !== "setup") return;
  const readyNames = PLAYER_NAMES.filter((name) => state.setupReady[name]).map(publicName);
  if (state.lastMessage) {
    statusText.textContent = state.lastMessage;
  } else if (state.setupReady[state.viewer]) {
    statusText.textContent = `Setup — ready${readyNames.length ? ` (${readyNames.join(", ")})` : ""}. Switch View As to prepare another player.`;
  } else {
    statusText.textContent = "Setup — click a hand card, then a face-up table card to swap; press READY when happy.";
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
  } else {
    document.body.dataset.gamePhase = "play";
  }
};

newGameBtn.addEventListener("click", () => {
  resetSetupPhase();
  render();
});

resetSetupPhase();
render();
