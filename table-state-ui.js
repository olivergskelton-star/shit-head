// Final table-state UI layer: compact opponent hands and authoritative Pile label/count.

function renderCompactOpponent(container, name) {
  if (!container) return;
  container.hidden = !name || !state.players?.[name];
  if (!name || !state.players?.[name]) { container.replaceChildren(); return; }
  const player = state.players[name];
  container.replaceChildren();
  container.classList.toggle("active", state.currentPlayer === name);

  const handWrap = document.createElement("div");
  handWrap.className = "opponent-hand-wrap";

  const hand = document.createElement("div");
  hand.className = "opponent-hand compact-opponent-hand";
  const count = player.hand.length;
  const visibleBacks = Math.min(count, 7);
  for (let i = 0; i < visibleBacks; i += 1) {
    const back = makeBack({ small: true });
    back.style.setProperty("--opponent-card-index", i);
    back.style.setProperty("--opponent-card-count", visibleBacks);
    hand.append(back);
  }

  const handCount = document.createElement("span");
  handCount.className = "opponent-hand-count";
  handCount.textContent = `×${count}`;
  handCount.setAttribute("aria-label", `${count} cards in hand`);
  handWrap.append(hand, handCount);

  const tableCards = document.createElement("div");
  tableCards.className = "card-row face-row";
  player.faceUp.forEach((card, index) => {
    const stack = document.createElement("div");
    stack.className = "face-stack";
    // Table cards must NOT use the compact `small` class. Their dimensions are
    // controlled by the final table-card CSS so they stay readable across the table.
    if (player.faceDown[index]) stack.append(makeBack());
    stack.append(makeCard(card));
    tableCards.append(stack);
  });

  const cardCluster = document.createElement("div");
  cardCluster.className = "opponent-card-cluster";
  cardCluster.append(handWrap, tableCards);

  // Keep the coaster as a fixed seat anchor; rotate/move only the cards as one unit.
  container.append(makeBeerMat(name, "opponent-beer-mat"), cardCluster);
}

renderOpponent = renderCompactOpponent;

function decoratePileUi() {
  const pile = document.querySelector("#discardPile");
  if (!pile) return;

  pile.setAttribute("aria-label", `Pile, ${state.discard.length} cards`);

  const wrap = pile.closest(".pile-wrap");
  const label = wrap?.querySelector(".pile-label");
  if (label) label.textContent = "Pile";

  // The engine owns one count badge beside the pile. Keeping it outside
  // `#discardPile` prevents the messy played-card render from deleting or
  // covering it.
  const count = wrap?.querySelector("#pileCount");
  if (count) {
    count.textContent = String(state.discard.length);
    count.classList.toggle("is-zero", state.discard.length === 0);
    count.setAttribute("aria-label", `${state.discard.length} card${state.discard.length === 1 ? "" : "s"} in pile`);
  }
}

const renderBeforeTableStateUi = render;
render = function renderWithTableStateUi() {
  renderBeforeTableStateUi();
  decoratePileUi();
};

render();
