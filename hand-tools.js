// Hand tools: house-order sorting and large-hand presentation helpers.

const HOUSE_HAND_ORDER = ["4", "5", "6", "7", "8", "9", "J", "Q", "K", "A", "2", "3", "10"];
const HOUSE_SUIT_ORDER = ["♠", "♥", "♦", "♣"];

function sortHandFor(name) {
  const player = state.players[name];
  if (!player) return;

  player.hand.sort((a, b) => {
    const rankDelta = HOUSE_HAND_ORDER.indexOf(a.rank) - HOUSE_HAND_ORDER.indexOf(b.rank);
    if (rankDelta !== 0) return rankDelta;
    return HOUSE_SUIT_ORDER.indexOf(a.suit) - HOUSE_SUIT_ORDER.indexOf(b.suit);
  });

  state.selected = [];
  if (Array.isArray(state.selectedRefs)) state.selectedRefs = [];
  state.selectedZone = null;
  if (state.setupSelection?.zone === "hand") state.setupSelection = null;
  state.lastMessage = `${publicName(name)} sorted the hand into house order.`;
  render();
}

function decorateHandTools() {
  const hand = playerSeat.querySelector(".hand");
  if (!hand) return;

  const count = state.players[state.viewer]?.hand.length || 0;
  hand.dataset.handCount = String(count);
  hand.classList.toggle("hand-many", count >= 8);
  hand.classList.toggle("hand-large", count >= 13);
  hand.classList.toggle("hand-huge", count >= 21);

  let sortButton = playerSeat.querySelector(".sort-hand");
  if (!sortButton) {
    sortButton = document.createElement("button");
    sortButton.type = "button";
    sortButton.className = "sort-hand";
    sortButton.innerHTML = `<span aria-hidden="true">⇅</span> SORT`;
    playerSeat.append(sortButton);
  }

  sortButton.setAttribute("aria-label", `Sort ${count} hand cards into house order`);
  sortButton.title = "Sort: 4 5 6 7 8 9 J Q K A 2 3 10";
  sortButton.onclick = () => sortHandFor(state.viewer);
}

const renderBeforeHandTools = render;
render = function renderWithHandTools() {
  renderBeforeHandTools();
  decorateHandTools();
};

render();