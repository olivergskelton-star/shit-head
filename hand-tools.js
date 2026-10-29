// Hand tools: house-order sorting and large-hand presentation helpers.

const HOUSE_HAND_ORDER = ["4", "5", "6", "7", "8", "9", "J", "Q", "K", "A", "2", "3", "10"];
const HOUSE_SUIT_ORDER = ["\u2660", "\u2665", "\u2666", "\u2663"];

function sortHandFor(name) {
  const player = state.players[name];
  if (!player) return;

  const role = window.ShitHeadMultiplayer?.status?.role || "local";
  if (role === "client" && state.phase === "play") {
    const sent = window.ShitHeadAuthoritativePlay?.sendTurnAction?.(name, "sort");
    if (!sent) statusText.textContent = "Could not send SORT to the host. Check the room connection.";
    return;
  }

  const direction = player.handSortDirection === "ascending" ? "descending" : "ascending";
  player.handSortDirection = direction;
  const sign = direction === "ascending" ? 1 : -1;
  player.hand.sort((a, b) => {
    const rankDelta = HOUSE_HAND_ORDER.indexOf(a.rank) - HOUSE_HAND_ORDER.indexOf(b.rank);
    if (rankDelta !== 0) return sign * rankDelta;
    return sign * (HOUSE_SUIT_ORDER.indexOf(a.suit) - HOUSE_SUIT_ORDER.indexOf(b.suit));
  });

  state.selected = [];
  if (Array.isArray(state.selectedRefs)) state.selectedRefs = [];
  state.selectedZone = null;
  if (state.setupSelection?.zone === "hand") state.setupSelection = null;
  state.lastMessage = `${publicName(name)} sorted the hand ${direction === "ascending" ? "low to high" : "high to low"}.`;
  render();

  // During setup a client still proposes only its own seat state. Send the sorted
  // hand immediately rather than letting a concurrent host render cancel the
  // delayed publish timer and put the old order back.
  if (role === "client" && state.phase === "setup") {
    window.ShitHeadMultiplayer?.publishState?.();
  }
}

function fitHandToWidth(hand, count) {
  const firstCard = hand?.querySelector("button.card");
  if (!hand || !firstCard || count < 2) {
    hand?.style.removeProperty("--adaptive-hand-margin");
    hand?.style.removeProperty("--adaptive-hand-rotation");
    return;
  }

  const cardWidth = firstCard.getBoundingClientRect().width || 62;
  const available = Math.max(220, hand.clientWidth - 24);
  const naturalStep = cardWidth - 8;
  const fittingStep = (available - cardWidth) / (count - 1);
  // Never let a resize push the last card out of view. On extremely large pickup
  // hands the visible slice gets narrow, but every card remains reachable.
  const step = Math.max(10, Math.min(naturalStep, fittingStep));
  const overlap = Math.max(0, cardWidth - step);

  hand.style.setProperty("--adaptive-hand-margin", `${-overlap}px`);
  const rotation = count >= 21 ? 0.45 : count >= 13 ? 0.9 : count >= 8 ? 1.7 : 5.4;
  hand.style.setProperty("--adaptive-hand-rotation", `${rotation}deg`);
}

function decorateHandTools() {
  const hand = playerSeat.querySelector(".hand");
  if (!hand) return;

  const count = state.players[state.viewer]?.hand.length || 0;
  hand.dataset.handCount = String(count);
  hand.classList.toggle("hand-many", count >= 8);
  hand.classList.toggle("hand-large", count >= 13);
  hand.classList.toggle("hand-huge", count >= 21);
  fitHandToWidth(hand, count);

  let sortButton = playerSeat.querySelector(".sort-hand");
  if (!sortButton) {
    sortButton = document.createElement("button");
    sortButton.type = "button";
    sortButton.className = "sort-hand";
    sortButton.innerHTML = `<span aria-hidden="true">&#8645;</span> SORT`;
    playerSeat.append(sortButton);
  }

  const descending = state.players[state.viewer]?.handSortDirection === "ascending";
  sortButton.setAttribute("aria-label", `Sort ${count} hand cards ${descending ? "high to low" : "low to high"}`);
  sortButton.title = descending ? "Sort high to low (reverse house order)" : "Sort low to high: 4 5 6 7 8 9 J Q K A 2 3 10";
  hand.setAttribute("aria-label", `Your hand, ${count} cards. Scroll horizontally to see more cards.`);
  sortButton.onclick = () => sortHandFor(state.viewer);
}

const renderBeforeHandTools = render;
render = function renderWithHandTools() {
  const scrollLeft = playerSeat.querySelector(".hand")?.scrollLeft || 0;
  renderBeforeHandTools();
  decorateHandTools();
  const hand = playerSeat.querySelector(".hand");
  if (hand) hand.scrollLeft = scrollLeft;
};

let handResizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(handResizeTimer);
  handResizeTimer = setTimeout(() => {
    const hand = playerSeat.querySelector(".hand");
    const count = state.players[state.viewer]?.hand.length || 0;
    fitHandToWidth(hand, count);
  }, 60);
});

render();
