const PLAYER_NAMES = ["Oliver", "Dan", "Chris"];
const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];

const state = {
  viewer: "Oliver",
  currentPlayer: "Oliver",
  theme: "kitchen",
  drawPile: [],
  discard: [],
  players: {},
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

function makeCard(card, { small = false, button = false, onClick } = {}) {
  const el = document.createElement(button ? "button" : "span");
  if (button) el.type = "button";
  el.className = `card${isRed(card) ? " red" : ""}${small ? " small" : ""}`;
  el.textContent = cardText(card);
  el.setAttribute("aria-label", cardText(card));
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
  player.faceUp.forEach((card) => {
    const stack = document.createElement("div");
    stack.className = "face-stack";
    if (player.faceDown.length) stack.append(makeBack({ small: true }));
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
      onClick: () => playCard(name, index),
    }));
  });

  const plate = document.createElement("div");
  plate.className = "nameplate";
  plate.innerHTML = `<span class="turn-dot"></span><span>${name} · You</span>`;

  playerSeat.append(tableCards, label, hand, plate);
}

function nextPlayer() {
  const currentIndex = PLAYER_NAMES.indexOf(state.currentPlayer);
  state.currentPlayer = PLAYER_NAMES[(currentIndex + 1) % PLAYER_NAMES.length];
}

function topDiscard() {
  return state.discard[state.discard.length - 1] || null;
}

function rankValue(rank) {
  return RANKS.indexOf(rank);
}

function canPlay(card) {
  const top = topDiscard();
  if (!top) return true;
  // Temporary baseline only. House-rule cards will replace this rule set.
  return rankValue(card.rank) >= rankValue(top.rank);
}

function refillHand(player) {
  while (player.hand.length < 3 && state.drawPile.length > 0) {
    player.hand.push(state.drawPile.pop());
  }
}

function playCard(name, index) {
  if (name !== state.currentPlayer) {
    statusText.textContent = `It’s ${state.currentPlayer}’s turn.`;
    return;
  }

  const player = state.players[name];
  const card = player.hand[index];
  if (!card) return;
  if (!canPlay(card)) {
    statusText.textContent = `${cardText(card)} can’t go on ${cardText(topDiscard())} under the temporary baseline rules.`;
    return;
  }

  player.hand.splice(index, 1);
  state.discard.push(card);
  refillHand(player);
  nextPlayer();
  render();
}

function drawForViewer() {
  if (state.viewer !== state.currentPlayer) {
    statusText.textContent = `It’s ${state.currentPlayer}’s turn.`;
    return;
  }
  if (!state.drawPile.length) {
    statusText.textContent = "The draw pile is empty.";
    return;
  }
  state.players[state.viewer].hand.push(state.drawPile.pop());
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
  statusText.textContent = state.currentPlayer === state.viewer
    ? "Your turn — choose a card."
    : `${state.currentPlayer}’s turn.`;
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
  render();
});

newGameBtn.addEventListener("click", dealNewGame);
drawPileButton.addEventListener("click", drawForViewer);

dealNewGame();
