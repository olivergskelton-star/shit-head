// Final table-state UI layer: compact opponent hands and authoritative Pile label/count.

function renderCompactOpponent(container, name) {
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
    if (player.faceDown[index]) stack.append(makeBack({ small: true }));
    stack.append(makeCard(card, { small: true }));
    tableCards.append(stack);
  });

  container.append(makeBeerMat(name, "opponent-beer-mat"), handWrap, tableCards);
}

renderOpponent = renderCompactOpponent;

function decoratePileUi() {
  const pile = document.querySelector("#discardPile");
  if (!pile) return;

  pile.setAttribute("aria-label", `Pile, ${state.discard.length} cards`);

  const wrap = pile.closest(".pile-wrap");
  const label = wrap?.querySelector(".pile-label");
  if (label) label.textContent = "Pile";

  let count = pile.querySelector(".discard-count");
  if (!count) {
    count = document.createElement("span");
    count.className = "pile-count discard-count";
    pile.append(count);
  }
  count.textContent = String(state.discard.length);
}

const renderBeforeTableStateUi = render;
render = function renderWithTableStateUi() {
  renderBeforeTableStateUi();
  decoratePileUi();
};

render();
