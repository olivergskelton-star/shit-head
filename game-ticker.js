// Game ticker: explicit current-turn indicator plus a compact running play history.
// Loaded last so it observes the final state produced by all game-rule layers.

state.gameHistory = [];
state.tickerLastMessage = "";
state.tickerLastTurn = null;
state.tickerWasPlaying = false;

function tickerIsGameEvent(message) {
  if (!message) return false;
  return /\b(starts?|played|picked up|burned|cleared|finished)\b/i.test(message)
    && !/\bsetup\b/i.test(message);
}

function tickerAdd(text, kind = "event") {
  if (!text) return;
  const previous = state.gameHistory[state.gameHistory.length - 1];
  if (previous?.text === text && previous?.kind === kind) return;
  state.gameHistory.push({ text, kind });
  if (state.gameHistory.length > 8) state.gameHistory.splice(0, state.gameHistory.length - 8);
}

function tickerReset() {
  state.gameHistory = [];
  state.tickerLastMessage = "";
  state.tickerLastTurn = null;
  state.tickerWasPlaying = false;
}

function captureTickerEvents() {
  if (state.phase !== "play") {
    state.tickerWasPlaying = false;
    return;
  }

  const justStarted = !state.tickerWasPlaying;
  state.tickerWasPlaying = true;

  if (state.lastMessage && state.lastMessage !== state.tickerLastMessage && tickerIsGameEvent(state.lastMessage)) {
    tickerAdd(state.lastMessage, "event");
    state.tickerLastMessage = state.lastMessage;
  }

  if (justStarted || state.currentPlayer !== state.tickerLastTurn) {
    tickerAdd(`${publicName(state.currentPlayer)}’s turn.`, "turn");
    state.tickerLastTurn = state.currentPlayer;
  } else if (state.lastMessage !== state.tickerLastMessage && /\b(go again|another .* available)\b/i.test(state.lastMessage || "")) {
    tickerAdd(`${publicName(state.currentPlayer)}’s turn.`, "turn");
  }
}

function renderGameTicker() {
  const statusbar = document.querySelector(".statusbar");
  if (!statusbar) return;

  if (state.phase !== "play") {
    statusbar.classList.remove("ticker-mode");
    const existing = statusbar.querySelector(".game-ticker-ui");
    if (existing) existing.remove();
    statusText.hidden = false;
    return;
  }

  statusbar.classList.add("ticker-mode");
  statusText.hidden = true;

  let ui = statusbar.querySelector(".game-ticker-ui");
  if (!ui) {
    ui = document.createElement("div");
    ui.className = "game-ticker-ui";
    ui.innerHTML = `
      <div class="turn-now" aria-live="polite">
        <span class="turn-now-label">CURRENT TURN</span>
        <strong class="turn-now-name"></strong>
      </div>
      <div class="history-ticker" aria-label="Recent play history" aria-live="polite"></div>
    `;
    statusbar.insertBefore(ui, newGameBtn);
  }

  ui.querySelector(".turn-now-name").textContent = `${publicName(state.currentPlayer)}’S TURN`;

  const ticker = ui.querySelector(".history-ticker");
  ticker.replaceChildren();
  const recent = state.gameHistory.slice(-5);
  recent.forEach((entry, index) => {
    const item = document.createElement("span");
    item.className = `ticker-item ticker-${entry.kind}`;
    item.textContent = entry.text;
    if (index === recent.length - 1) item.classList.add("latest");
    ticker.append(item);
    if (index < recent.length - 1) {
      const arrow = document.createElement("span");
      arrow.className = "ticker-arrow";
      arrow.textContent = "→";
      ticker.append(arrow);
    }
  });
}

const renderBeforeGameTicker = render;
render = function renderWithGameTicker() {
  renderBeforeGameTicker();
  captureTickerEvents();
  renderGameTicker();
};

newGameBtn.addEventListener("click", tickerReset);

render();
