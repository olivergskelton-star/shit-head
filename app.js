const PLAYER_NAMES = ["Oliver", "Dan", "Chris"];
const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const NORMAL_ORDER = ["4", "5", "6", "7", "8", "9", "J", "Q", "K", "A"];
const PLAYER_PROFILE = {
  Oliver: { score: 0, drink: "Wine", icon: "🍷" },
  Dan: { score: 0, drink: "Beer", icon: "🍺" },
  Chris: { score: 0, drink: "Cocktail", icon: "🍸" },
};

function loadDisplayNames() {
  return Object.fromEntries(PLAYER_NAMES.map((name) => {
    const saved = localStorage.getItem(`shithead-display-name-${name}`);
    return [name, saved || name];
  }));
}

const state = {
  viewer: "Oliver",
  currentPlayer: "Oliver",
  theme: "kitchen",
  drawPile: [],
  discard: [],
  players: {},
  selected: [],
  lastMessage: "",
  displayNames: loadDisplayNames(),
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

function buildDeck() { return SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit }))); }
function shuffle(cards) {
  const copy = [...cards];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
function cardText(card) { return `${card.rank}${card.suit}`; }
function isRed(card) { return card.suit === "♥" || card.suit === "♦"; }
function publicName(name) { return state.displayNames[name] || name; }

function dealNewGame() {
  const deck = shuffle(buildDeck());
  state.discard = [];
  state.selected = [];
  state.lastMessage = "";
  state.currentPlayer = PLAYER_NAMES[Math.floor(Math.random() * PLAYER_NAMES.length)];
  state.players = Object.fromEntries(PLAYER_NAMES.map((name) => [name, { faceDown: [], faceUp: [], hand: [] }]));
  for (let round = 0; round < 3; round += 1) PLAYER_NAMES.forEach((name) => state.players[name].faceDown.push(deck.pop()));
  for (let round = 0; round < 3; round += 1) PLAYER_NAMES.forEach((name) => state.players[name].faceUp.push(deck.pop()));
  for (let round = 0; round < 3; round += 1) PLAYER_NAMES.forEach((name) => state.players[name].hand.push(deck.pop()));
  state.drawPile = deck;
  render();
}

function seatingForViewer() {
  const i = PLAYER_NAMES.indexOf(state.viewer);
  return { self: PLAYER_NAMES[i], left: PLAYER_NAMES[(i + 1) % 3], right: PLAYER_NAMES[(i + 2) % 3] };
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

function editDisplayName(name) {
  const current = publicName(name);
  const next = window.prompt("This week’s name", current);
  if (next === null) return;
  const cleaned = next.trim().slice(0, 24);
  state.displayNames[name] = cleaned || name;
  localStorage.setItem(`shithead-display-name-${name}`, state.displayNames[name]);
  render();
}

function makeBeerMat(name, extraClass = "", editable = false) {
  const profile = PLAYER_PROFILE[name];
  const displayName = publicName(name);
  const mat = document.createElement(editable ? "button" : "div");
  if (editable) mat.type = "button";
  mat.className = `beer-mat ${extraClass}${editable ? " editable" : ""}`.trim();
  const pathId = `mat-${name}-${Math.random().toString(36).slice(2, 8)}`;
  mat.innerHTML = `
    <svg class="beer-mat-name-ring" viewBox="0 0 100 100" aria-hidden="true">
      <defs><path id="${pathId}" d="M 15,56 A 38,38 0 0,1 85,56" /></defs>
      <text><textPath href="#${pathId}" startOffset="50%" text-anchor="middle">${displayName}</textPath></text>
    </svg>
    <span class="beer-mat-score">${profile.score}</span>
    <span class="beer-mat-drink" aria-hidden="true">${profile.icon}</span>
    <span class="beer-mat-label">${profile.drink}</span>
    ${editable ? '<span class="beer-mat-edit">✎</span>' : ""}
  `;
  mat.setAttribute("aria-label", `${displayName}, score ${profile.score}, drinking ${profile.drink}${editable ? ". Click to change weekly name." : ""}`);
  if (editable) mat.addEventListener("click", () => editDisplayName(name));
  return mat;
}

function renderOpponent(container, name) {
  const player = state.players[name];
  container.replaceChildren();
  container.classList.toggle("active", state.currentPlayer === name);
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
  container.append(makeBeerMat(name, "opponent-beer-mat"), hand, tableCards);
}

function renderSelf(name) {
  const player = state.players[name];
  playerSeat.replaceChildren();
  playerSeat.classList.toggle("active", state.currentPlayer === name);
  const tableZone = document.createElement("div");
  tableZone.className = "self-table-zone";
  const tableCards = document.createElement("div");
  tableCards.className = "card-row face-row self-face-row";
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
  tableZone.append(label, tableCards);

  const hand = document.createElement("div");
  hand.className = "hand";
  player.hand.forEach((card, index) => {
    const cardEl = makeCard(card, { button: true, selected: state.selected.includes(index), onClick: () => toggleCardSelection(name, index) });
    cardEl.style.setProperty("--card-index", index);
    cardEl.style.setProperty("--card-mid", (player.hand.length - 1) / 2);
    hand.append(cardEl);
  });

  const actions = document.createElement("div");
  actions.className = `play-actions${state.selected.length ? " visible" : ""}`;
  const playButton = document.createElement("button");
  playButton.type = "button";
  playButton.className = "play-selected";
  playButton.textContent = state.selected.length > 1 ? `PLAY ${state.selected.length}` : "PLAY";
  playButton.disabled = state.currentPlayer !== name || state.selected.length === 0;
  playButton.addEventListener("click", () => playSelected(name));
  const selectionHint = document.createElement("span");
  selectionHint.className = "selection-hint";
  selectionHint.textContent = state.selected.length > 1 ? `${state.selected.length} matching cards` : "Selected";
  actions.append(playButton, selectionHint);

  const selfIdentity = document.createElement("div");
  selfIdentity.className = "self-identity-row";
  selfIdentity.append(makeBeerMat(name, "self-beer-mat", true));
  playerSeat.append(tableZone, selfIdentity, hand, actions);
}

function toggleCardSelection(name, index) {
  if (name !== state.currentPlayer) { state.lastMessage = `It’s ${publicName(state.currentPlayer)}’s turn.`; render(); return; }
  const hand = state.players[name].hand;
  const card = hand[index];
  if (!card) return;
  if (state.selected.includes(index)) { state.selected = state.selected.filter((i) => i !== index); state.lastMessage = ""; render(); return; }
  if (state.selected.length) {
    const first = hand[state.selected[0]];
    if (first && first.rank !== card.rank) { state.selected = [index]; state.lastMessage = "Only matching cards can be played together."; render(); return; }
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
function topDiscard() { return state.discard[state.discard.length - 1] || null; }
function normalRankValue(rank) { return NORMAL_ORDER.indexOf(rank); }
function canPlayRank(rank) {
  const top = topDiscard();
  if (!top) return true;
  if (rank === "2" || rank === "3" || rank === "10") return true;
  if (top.rank === "2") return true;
  if (top.rank === "7") return normalRankValue(rank) !== -1 && normalRankValue(rank) <= normalRankValue("7");
  if (top.rank === "3") return true;
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
function refillHand(player) { while (player.hand.length < 3 && state.drawPile.length > 0) player.hand.push(state.drawPile.pop()); }

function playSelected(name) {
  if (name !== state.currentPlayer) { state.lastMessage = `It’s ${publicName(state.currentPlayer)}’s turn.`; render(); return; }
  const player = state.players[name];
  const indices = [...state.selected].sort((a, b) => a - b);
  if (!indices.length) return;
  const cards = indices.map((index) => player.hand[index]).filter(Boolean);
  if (!cards.length) return;
  const rank = cards[0].rank;
  if (!cards.every((card) => card.rank === rank)) { state.lastMessage = "Only matching ranks can be played together."; render(); return; }
  if (!canPlayRank(rank)) { state.lastMessage = `${cards.map(cardText).join(", ")} can’t go on ${cardText(topDiscard())}.`; render(); return; }
  for (const index of [...indices].sort((a, b) => b - a)) player.hand.splice(index, 1);
  cards.forEach((card) => state.discard.push(card));
  const cleared = shouldClearPile(rank);
  const n = publicName(name);
  if (cleared) {
    state.discard = [];
    state.lastMessage = rank === "10" ? `${n} cleared the pile with a 10 — go again.` : rank === "8" ? `${n} cleared the pile with three 8s — go again.` : `${n} cleared the pile with four ${rank}s — go again.`;
  } else if (rank === "2") state.lastMessage = `${n} reset the pile with a 2.`;
  else if (rank === "7") state.lastMessage = `${n} played a 7 — ${publicName(PLAYER_NAMES[(PLAYER_NAMES.indexOf(name) + 1) % PLAYER_NAMES.length])} must play 7 or lower.`;
  else if (rank === "3") state.lastMessage = `${n} played a 3.`;
  else state.lastMessage = `${n} played ${cards.length > 1 ? cards.length + " × " + rank : cardText(cards[0])}.`;
  refillHand(player);
  state.selected = [];
  if (!cleared) nextPlayer();
  render();
}

function drawForViewer() {
  if (state.viewer !== state.currentPlayer) { state.lastMessage = `It’s ${publicName(state.currentPlayer)}’s turn.`; render(); return; }
  if (!state.drawPile.length) { state.lastMessage = "The draw pile is empty."; render(); return; }
  state.players[state.viewer].hand.push(state.drawPile.pop());
  state.lastMessage = `${publicName(state.viewer)} drew a card.`;
  render();
}

function renderDiscard() {
  discardPile.replaceChildren();
  const top = topDiscard();
  if (top) discardPile.append(makeCard(top));
  else {
    const placeholder = document.createElement("span");
    placeholder.className = "card empty-pile";
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
  statusText.textContent = state.lastMessage || (state.currentPlayer === state.viewer ? "Your turn — choose a card." : `${publicName(state.currentPlayer)}’s turn.`);
}

PLAYER_NAMES.forEach((name) => {
  const option = document.createElement("option");
  option.value = name;
  option.textContent = name;
  viewerSelect.append(option);
});
viewerSelect.value = state.viewer;
themeSelect.addEventListener("change", () => { state.theme = themeSelect.value; document.body.dataset.theme = state.theme; });
viewerSelect.addEventListener("change", () => { state.viewer = viewerSelect.value; state.selected = []; state.lastMessage = ""; render(); });
newGameBtn.addEventListener("click", dealNewGame);
drawPileButton.addEventListener("click", drawForViewer);
dealNewGame();
