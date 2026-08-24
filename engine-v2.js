// Engine v2: transparent 3s, burn pile, voluntary pickup.
// Loaded after app.js so we can harden game dynamics without disturbing the table prototype.

state.burnPile = [];

function effectiveTopDiscard() {
  for (let i = state.discard.length - 1; i >= 0; i -= 1) {
    if (state.discard[i].rank !== "3") return state.discard[i];
  }
  return null;
}

canPlayRank = function canPlayRankV2(rank) {
  // 2, 3 and 10 can always be played.
  if (rank === "2" || rank === "3" || rank === "10") return true;

  // 3s are transparent: judge against the last non-3 beneath them.
  const targetCard = effectiveTopDiscard();
  if (!targetCard) return true;

  // A 2 resets the pile, even if one or more 3s sit on top of it.
  if (targetCard.rank === "2") return true;

  // A 7 forces the next ordinary card to be 7 or lower.
  if (targetCard.rank === "7") {
    const candidate = normalRankValue(rank);
    return candidate !== -1 && candidate <= normalRankValue("7");
  }

  const candidate = normalRankValue(rank);
  const target = normalRankValue(targetCard.rank);
  if (candidate === -1 || target === -1) return false;
  return candidate >= target;
};

function burnDiscardPile() {
  if (!state.discard.length) return;
  state.burnPile.push(...state.discard);
  state.discard = [];
}

function pickupDiscard(name) {
  if (name !== state.currentPlayer) {
    state.lastMessage = `It’s ${publicName(state.currentPlayer)}’s turn.`;
    render();
    return;
  }
  if (!state.discard.length) {
    state.lastMessage = "There’s no discard pile to pick up.";
    render();
    return;
  }

  const count = state.discard.length;
  state.players[name].hand.push(...state.discard);
  state.discard = [];
  state.selected = [];
  state.lastMessage = `${publicName(name)} picked up ${count} card${count === 1 ? "" : "s"}.`;
  nextPlayer();
  render();
}

playSelected = function playSelectedV2(name) {
  if (name !== state.currentPlayer) {
    state.lastMessage = `It’s ${publicName(state.currentPlayer)}’s turn.`;
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
    const target = effectiveTopDiscard();
    state.lastMessage = target
      ? `${cards.map(cardText).join(", ")} can’t go on ${cardText(target)}${topDiscard()?.rank === "3" ? " through the transparent 3" : ""}.`
      : "That play isn’t legal.";
    render();
    return;
  }

  for (const index of [...indices].sort((a, b) => b - a)) player.hand.splice(index, 1);
  cards.forEach((card) => state.discard.push(card));

  const cleared = shouldClearPile(rank);
  const n = publicName(name);

  if (cleared) {
    const burnedCount = state.discard.length;
    burnDiscardPile();
    state.lastMessage = rank === "10"
      ? `${n} burned ${burnedCount} cards with a 10 — go again.`
      : rank === "8"
        ? `${n} burned the pile with three 8s — go again.`
        : `${n} burned the pile with four ${rank}s — go again.`;
  } else if (rank === "2") {
    state.lastMessage = `${n} reset the pile with a 2.`;
  } else if (rank === "7") {
    state.lastMessage = `${n} played a 7 — ${publicName(PLAYER_NAMES[(PLAYER_NAMES.indexOf(name) + 1) % PLAYER_NAMES.length])} must play 7 or lower.`;
  } else if (rank === "3") {
    const target = effectiveTopDiscard();
    state.lastMessage = target
      ? `${n} played a transparent 3 — ${cardText(target)} is still the live card.`
      : `${n} played a transparent 3.`;
  } else {
    state.lastMessage = `${n} played ${cards.length > 1 ? cards.length + " × " + rank : cardText(cards[0])}.`;
  }

  refillHand(player);
  state.selected = [];
  if (!cleared) nextPlayer();
  render();
};

function ensureBurnPileUi() {
  const centre = document.querySelector(".centre-zone");
  if (!centre || document.querySelector("#burnPile")) return;

  const wrap = document.createElement("div");
  wrap.className = "pile-wrap burn-wrap";
  wrap.innerHTML = `
    <div id="burnPile" class="pile pile-burn" aria-label="Burn pile">
      <span class="card card-back burn-card"></span>
      <span id="burnCount" class="pile-count">0</span>
    </div>
    <span class="pile-label">Burn</span>
  `;
  centre.append(wrap);
}

function enhanceTurnActions() {
  const actions = playerSeat.querySelector(".play-actions");
  if (!actions) return;

  const canPickup = state.currentPlayer === state.viewer && state.discard.length > 0;
  if (canPickup) actions.classList.add("visible");

  let pickup = actions.querySelector(".pickup-pile");
  if (!pickup) {
    pickup = document.createElement("button");
    pickup.type = "button";
    pickup.className = "pickup-pile";
    pickup.textContent = "PICK UP";
    actions.append(pickup);
  }
  pickup.disabled = !canPickup;
  pickup.onclick = () => pickupDiscard(state.viewer);
}

function renderBurnPile() {
  const burnCount = document.querySelector("#burnCount");
  const burnPile = document.querySelector("#burnPile");
  if (!burnCount || !burnPile) return;
  burnCount.textContent = state.burnPile.length;
  burnPile.classList.toggle("has-cards", state.burnPile.length > 0);
}

const renderV1 = render;
render = function renderV2() {
  renderV1();
  ensureBurnPileUi();
  enhanceTurnActions();
  renderBurnPile();
};

// The original New deal listener runs first. This listener resets v2-only state afterwards.
newGameBtn.addEventListener("click", () => {
  state.burnPile = [];
  render();
});

ensureBurnPileUi();
render();
