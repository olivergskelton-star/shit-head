// Engine v2: transparent 3s, burn pile, voluntary pickup, same-rank follow-up priority.
// Loaded after app.js so game dynamics can evolve independently of the table prototype.

state.burnPile = [];
state.followUpRank = null;

function effectiveTopDiscard() {
  for (let i = state.discard.length - 1; i >= 0; i -= 1) {
    if (state.discard[i].rank !== "3") return state.discard[i];
  }
  return null;
}

canPlayRank = function canPlayRankV2(rank) {
  if (state.followUpRank && rank !== state.followUpRank) return false;
  if (rank === "2" || rank === "3" || rank === "10") return true;

  const targetCard = effectiveTopDiscard();
  if (!targetCard) return true;
  if (targetCard.rank === "2") return true;

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

function hasFollowUpCard(name, rank) {
  return state.players[name].hand.some((card) => card.rank === rank);
}

function finishTurn(name) {
  if (name !== state.currentPlayer || !state.followUpRank) return;
  const rank = state.followUpRank;
  state.followUpRank = null;
  state.selected = [];
  state.lastMessage = `${publicName(name)} finished the ${rank}s.`;
  nextPlayer();
  render();
}

function pickupDiscard(name) {
  if (name !== state.currentPlayer) {
    state.lastMessage = `It’s ${publicName(state.currentPlayer)}’s turn.`;
    render();
    return;
  }
  if (state.followUpRank) {
    state.lastMessage = `You’ve already played — add another ${state.followUpRank} or finish the turn.`;
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

const toggleCardSelectionV1 = toggleCardSelection;
toggleCardSelection = function toggleCardSelectionV2(name, index) {
  if (state.followUpRank) {
    if (name !== state.currentPlayer) return;
    const card = state.players[name].hand[index];
    if (!card) return;
    if (card.rank !== state.followUpRank) {
      state.lastMessage = `Only another ${state.followUpRank} can be added before the turn passes.`;
      render();
      return;
    }
  }
  toggleCardSelectionV1(name, index);
};

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

  if (state.followUpRank && rank !== state.followUpRank) {
    state.lastMessage = `Only another ${state.followUpRank} can be added before the turn passes.`;
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
    state.followUpRank = null;
    state.lastMessage = rank === "10"
      ? `${n} burned ${burnedCount} cards with a 10 — go again.`
      : rank === "8"
        ? `${n} burned the pile with three 8s — go again.`
        : `${n} burned the pile with four ${rank}s — go again.`;
    refillHand(player);
    state.selected = [];
    render();
    return;
  }

  refillHand(player);
  state.selected = [];

  if (hasFollowUpCard(name, rank)) {
    state.followUpRank = rank;
    state.lastMessage = `${n} played ${cards.length > 1 ? cards.length + " × " + rank : cardText(cards[0])}. Another ${rank} is available — add it or finish turn.`;
  } else {
    state.followUpRank = null;
    if (rank === "2") state.lastMessage = `${n} reset the pile with a 2.`;
    else if (rank === "7") state.lastMessage = `${n} played a 7 — ${publicName(PLAYER_NAMES[(PLAYER_NAMES.indexOf(name) + 1) % PLAYER_NAMES.length])} must play 7 or lower.`;
    else if (rank === "3") {
      const target = effectiveTopDiscard();
      state.lastMessage = target ? `${n} played a transparent 3 — ${cardText(target)} is still the live card.` : `${n} played a transparent 3.`;
    } else state.lastMessage = `${n} played ${cards.length > 1 ? cards.length + " × " + rank : cardText(cards[0])}.`;
    nextPlayer();
  }

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

  const isMyTurn = state.currentPlayer === state.viewer;
  const followUp = isMyTurn && !!state.followUpRank;
  const canPickup = isMyTurn && !state.followUpRank && state.discard.length > 0;
  if (canPickup || followUp) actions.classList.add("visible");

  let pickup = actions.querySelector(".pickup-pile");
  if (!pickup) {
    pickup = document.createElement("button");
    pickup.type = "button";
    pickup.className = "pickup-pile";
    pickup.textContent = "PICK UP";
    actions.append(pickup);
  }
  pickup.hidden = followUp;
  pickup.disabled = !canPickup;
  pickup.onclick = () => pickupDiscard(state.viewer);

  let finish = actions.querySelector(".finish-turn");
  if (!finish) {
    finish = document.createElement("button");
    finish.type = "button";
    finish.className = "finish-turn";
    finish.textContent = "FINISH TURN";
    actions.append(finish);
  }
  finish.hidden = !followUp;
  finish.disabled = !followUp;
  finish.onclick = () => finishTurn(state.viewer);
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

newGameBtn.addEventListener("click", () => {
  state.burnPile = [];
  state.followUpRank = null;
  render();
});

ensureBurnPileUi();
render();
