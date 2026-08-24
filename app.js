const PLAYER_NAMES = ["Oliver", "Dan", "Chris"];
const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const NORMAL_ORDER = ["4", "5", "6", "7", "8", "9", "J", "Q", "K", "A"];

const state = {
  viewer: "Oliver",
  currentPlayer: "Oliver",
  theme: "kitchen",
  drawPile: [],
  discard: [],
  players: {},
  selected: [],
  lastMessage: "",
};

const viewerSelect = document.querySelector("#viewerSelect");
const themeSelect = document.querySelector("#themeSelect");
const opponentLeft = document.querySelector("#opponentLeft");
const opponentRight = document.querySelector("#opponentRight");
const playerSeat = document.querySelector("#playerSeat");
const discardPile = document.querySelector("#discardPile");
const drawCount = document.querySelector("#drawCount");
const drawPileButton = document.querySelector("#drawPile");
const statusText = document.querySelector("#statusText");
const newGameBtn = document.querySelector("#newGameBtn");

function buildDeck() {
  return SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit })));
}

function shuffle(cards) {
  const copy = [...cards];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function cardText(card) {
  return `${card.rank}${card.suit}`;
}

function isRed(card) {
  return card.suit === "♥" || card.suit === "♦";
}

function dealNewGame() {
  const deck = shuffle(buildDeck());
  state.discard = [];
  state.selected = [];
  state.lastMessage = "";
  state.currentPlayer = PLAYER_NAMES[Math.floor(Math.random() * PLAYER_NAMES.length)];
  state.players = Object.fromEntries(
    PLAYER_NAMES.map((name) => [name, { faceDown: [], faceUp: [], hand: [] }])
  );

  for (let round = 0; round < 3; round += 1) {
    PLAYER_NAMES.forEach((name) => state.players[name].faceDown.push(deck.pop()));
  }
  for (let round = 0; round < 3; round += 1) {
    PLAYER_NAMES.forEach((name) => state.players[name].faceUp.push(deck.pop()));
  }
  for (let round = 0; round < 3; round += 1) {
    PLAYER_NAMES.forEach((name) => state.players[name].hand.push(deck.pop()));
  }

  state.drawPile = deck;
  render();
}

function seatingForViewer() {
  const i = PLAYER_NAMES.indexOf(state.viewer);
  return {
    self: PLAYER_NAMES[i],
    left: PLAYER_NAMES[(i + 1) % PLAYER_NAMES.length],
    right: PLAYER_NAMES[(i + 2) % PLAYER_NAMES.length],
  };
}

function makeCard(card, { small = false, button = false, selected = false, onClick } = {}) {
  const el = document.createElement(button ? "button" : "span");
  if (button) el.type = "button";
  el.className = `card${isRed(card) ? " red" : ""}${small ? " small" : ""}${selected ? " selected" : ""}`;
  el.textContent = cardText(card);
  el.setAttribute("aria-label", `${cardText(card)}${selected ? ", selected" : ""}`);
  if (button) el.setAttribute("aria-pressed", selected ? "true" : "false");
  if (onClick) el.addEventListener("click", onClick);
  return el;
}

function makeBack({ small = false } = {}) {
  const el = document.createElement("span");
  el.className = `card card-back${small ? " small" : ""}`;
  el.setAttribute("aria-label", "Face-down card");
  return el;
}

function renderOpponent(container, name) {
  const player = state.players[name];
  container.replaceChildren();
  container.classList.toggle("active", state.currentPlayer === name);

  const plate = document.createElement("div");
  plate.className = "nameplate";
  plate.innerHTML = `<span class="turn-dot"></span><span>${name}</span>`;

  const hand = document.createElement("div");
  hand.className = "card-row opponent-hand";
  player.hand.forEach(() => hand.append(makeBack({ small: true })));

  const tableCards = document.createElement("div");
  tableCards.className = "card-row face-row";
  player.faceUp.forEach((card, index) => {
    const stack = document.createElement("div");
    stack.className = "face-stack";
    if (player.faceDown[index]) stack.append(makeBack({ small: true }));
    stack.append(makeCard(card, { small: true }));
    tableCards.append(stack);
  });

  container.append(plate, hand, tableCards);
}

function renderSelf(name) {
  const player = state.players[name];
  playerSeat.replaceChildren();
  playerSeat.classList.toggle("active", state.currentPlayer === name);

  const tableCards = document.createElement("div");
  tableCards.className = "card-row face-row";
  player.faceUp.forEach((card, index) => {
    const stack = document.createElement("div");
    stack.className = "face-stack";
    if (player.faceDown[index]) stack.append(makeBack());
    stack.append(makeCard(card));
    tableCards.append(stack);
  });

  const label = document.createElement("p");
  label.className = "player-label";
  label.textContent = "Your table cards";

  const hand = document.createElement("div");
  hand.className = "hand";
  player.hand.forEach((card, index) => {
    hand.append(makeCard(card, {
      button: true,
      selected: state.selected.includes(index),
      onClick: () => toggleCardSelection(name, index),
    }));
  });

  const actions = document.createElement("div");
  actions.className = "play-actions";

  const playButton = document.createElement("button");
  playButton.type = "button";
  playButton.className = "play-selected";
  playButton.textContent = state.selected.length > 1 ? `Play ${state.selected.length} cards` : "Play card";
  playButton.disabled = state.currentPlayer !== name || state.selected.length === 0;
  playButton.addEventListener("click", () => playSelected(name));

  const selectionHint = document.createElement("span");
  selectionHint.className = "selection-hint";
  selectionHint.textContent = state.selected.length > 1
    ? `${state.selected.length} matching cards selected`
    : "Tap matching cards to play multiples";

  actions.append(playButton, selectionHint);

  const plate = document.createElement("div");
  plate.className = "nameplate";
  plate.innerHTML = `<span class="turn-dot"></span><span>${name} · You</span>`;

  playerSeat.append(tableCards, label, hand, actions, plate);
}

function toggleCardSelection(name, index) {
  if (name !== state.currentPlayer) {
    state.lastMessage = `It’s ${state.currentPlayer}’s turn.`;
    render();
    return;
  }

  const hand = state.players[name].hand;
  const card = hand[index];
  if (!card) return;

  if (state.selected.includes(index)) {
    state.selected = state.selected.filter((i) => i !== index);
    state.lastMessage = "";
    render();
    return;
  }

  if (state.selected.length) {
    const first = hand[state.selected[0]];
    if (first && first.rank !== card.rank) {
      state.selected = [index];
      state.lastMessage = "You can only play multiple cards of the same rank together.";
      render();
      return;
    }
  }

  state.selected.push(index);
  state.selected.sort((a, b) => a - b);
  state.lastMessage = "";
  render();
}

function nextPlayer() {
  const currentIndex = PLAYER_NAMES.indexOf(state.currentPlayer);
  state.currentPlayer = PLAYER_NAMES[(currentIndex + 1) % PLAYER_NAMES.length];
  state.selected = [];
}

function topDiscard() {
  return state.discard[state.discard.length - 1] || null;
}

function normalRankValue(rank) {
  return NORMAL_ORDER.indexOf(rank);
}

function canPlayRank(rank) {
  const top = topDiscard();
  if (!top) return true;

  // Special cards can always be played.
  if (rank === "2" || rank === "3" || rank === "10") return true;

  // A 2 resets the pile: anything may follow it.
  if (top.rank === "2") return true;

  // A 7 forces the next ordinary card to be 7 or lower.
  if (top.rank === "7") {
    return normalRankValue(rank) !== -1 && normalRankValue(rank) <= normalRankValue("7");
  }

  // 3 is playable on anything but otherwise remains the visible top card.
  if (top.rank === "3") return true;

  // Ordinary play is equal or higher.
  const candidate = normalRankValue(rank);
  const target = normalRankValue(top.rank);
  if (candidate === -1 || target === -1) return false;
  return candidate >= target;
}

function consecutiveTopCount(rank) {
  let count = 0;
  for (let i = state.discard.length - 1; i >= 0; i -= 1) {
    if (state.discard[i].rank !== rank) break;
    count += 1;
  }
  return count;
}

function shouldClearPile(rank) {
  if (rank === "10") return true;
  const count = consecutiveTopCount(rank);
  if (rank === "8") return count >= 3;
  return count >= 4;
}

function refillHand(player) {
  while (player.hand.length < 3 && state.drawPile.length > 0) {
    player.hand.push(state.drawPile.pop());
  }
}

function playSelected(name) {
  if (name !== state.currentPlayer) {
    state.lastMessage = `It’s ${state.currentPlayer}’s turn.`;
    render();
    return;
  }

  const player = state.players[name];
  const indices = [...state.selected].sort((a, b) => a - b);
  if (!indices.length) return;

  const cards = indices.map((index) => player.hand[index]).filter(Boolean);
  if (!cards.length) return;

  const rank = cards[0].rank;
  if (!cards.every((card) => card.rank === rank)) {
    state.lastMessage = "Only matching ranks can be played together.";
    render();
    return;
  }

  if (!canPlayRank(rank)) {
    state.lastMessage = `${cards.map(cardText).join(", ")} can’t go on ${cardText(topDiscard())}.`;
    render();
    return;
  }

  for (const index of [...indices].sort((a, b) => b - a)) {
    player.hand.splice(index, 1);
  }
  cards.forEach((card) => state.discard.push(card));

  const cleared = shouldClearPile(rank);
  if (cleared) {
    state.discard = [];
    state.lastMessage = rank === "10"
      ? `${name} cleared the pile with a 10 and goes again.`
      : rank === "8"
        ? `${name} cleared the pile with three 8s and goes again.`
        : `${name} cleared the pile with four ${rank}s and goes again.`;
  } else if (rank === "2") {
    state.lastMessage = `${name} played a 2 — the pile is reset.`;
  } else if (rank === "7") {
    state.lastMessage = `${name} played a 7 — next card must be 7 or lower.`;
  } else if (rank === "3") {
    state.lastMessage = `${name} played a 3 — playable on anything.`;
  } else {
    state.lastMessage = `${name} played ${cards.length > 1 ? cards.length + " × " + rank : cardText(cards[0])}.`;
  }

  refillHand(player);
  state.selected = [];

  // Clearing the pile keeps the turn; otherwise play moves clockwise.
  if (!cleared) nextPlayer();
  render();
}

function drawForViewer() {
  if (state.viewer !== state.currentPlayer) {
    state.lastMessage = `It’s ${state.currentPlayer}’s turn.`;
    render();
    return;
  }
  if (!state.drawPile.length) {
    state.lastMessage = "The draw pile is empty.";
    render();
    return;
  }
  state.players[state.viewer].hand.push(state.drawPile.pop());
  state.lastMessage = `${state.viewer} drew a card.`;
  render();
}

function renderDiscard() {
  discardPile.replaceChildren();
  const top = topDiscard();
  if (top) {
    discardPile.append(makeCard(top));
  } else {
    const placeholder = document.createElement("span");
    placeholder.className = "card";
    placeholder.style.opacity = ".16";
    placeholder.textContent = "—";
    discardPile.append(placeholder);
  }
  drawCount.textContent = state.drawPile.length;
}

function render() {
  const seats = seatingForViewer();
  renderOpponent(opponentLeft, seats.left);
  renderOpponent(opponentRight, seats.right);
  renderSelf(seats.self);
  renderDiscard();

  if (state.lastMessage) {
    statusText.textContent = `${state.lastMessage} ${state.currentPlayer === state.viewer ? "Your turn." : `It’s ${state.currentPlayer}’s turn.`}`;
  } else {
    statusText.textContent = state.currentPlayer === state.viewer
      ? "Your turn — select a card, or matching cards, then play."
      : `${state.currentPlayer}’s turn.`;
  }
}

PLAYER_NAMES.forEach((name) => {
  const option = document.createElement("option");
  option.value = name;
  option.textContent = name;
  viewerSelect.append(option);
});
viewerSelect.value = state.viewer;

themeSelect.addEventListener("change", () => {
  state.theme = themeSelect.value;
  document.body.dataset.theme = state.theme;
});

viewerSelect.addEventListener("change", () => {
  state.viewer = viewerSelect.value;
  state.selected = [];
  state.lastMessage = "";
  render();
});

newGameBtn.addEventListener("click", dealNewGame);
drawPileButton.addEventListener("click", drawForViewer);

dealNewGame();
