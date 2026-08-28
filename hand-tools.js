// Hand tools: house-order sorting and large-hand presentation helpers.

const HOUSE_HAND_ORDER = ["4", "5", "6", "7", "8", "9", "J", "Q", "K", "A", "2", "3", "10"];
const HOUSE_SUIT_ORDER = ["♠", "♥", "♦", "♣"];

function sortHandFor(name) {
  const player = state.players[name];
  if (!player) return;

  const role = window.ShitHeadMultiplayer?.status?.role || "local";
  if (role === "client" && state.phase === "play") {
    const sent = window.ShitHeadAuthoritativePlay?.sendTurnAction?.(name, "sort");
    if (!sent) statusText.textContent = "Could not send SORT to the host. Check the room connection.";
    return;
  }

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