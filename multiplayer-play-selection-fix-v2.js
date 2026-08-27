// Safe multiplayer client card-selection layer.
// Selection is private UI state: keep it local on a client until PLAY is pressed.
// Repaint once after normal game renders; do not observe/mutate the DOM recursively.
(() => {
  let localSelected = [];
  let localRank = null;

  function isOnlineClientTurn() {
    const mp = window.ShitHeadMultiplayer;
    return !!mp
      && mp.status?.role === 'client'
      && state.phase === 'play'
      && state.currentPlayer === state.viewer;
  }

  function handButtons() {
    return [...playerSeat.querySelectorAll('.hand button.card')];
  }

  function clearLocalSelection() {
    localSelected = [];
    localRank = null;
    if (Array.isArray(state.selected)) state.selected = [];
  }

  function paintSelection() {
    if (!isOnlineClientTurn()) {
      clearLocalSelection();
      return;
    }

    const hand = state.players[state.viewer]?.hand || [];
    localSelected = localSelected.filter((index) => Number.isInteger(index) && index >= 0 && index < hand.length);
    if (!localSelected.length) localRank = null;
    state.selected = [...localSelected];

    handButtons().forEach((button, index) => {
      const selected = localSelected.includes(index);
      button.classList.toggle('selected', selected);
      if (button.getAttribute('aria-pressed') !== String(selected)) {
        button.setAttribute('aria-pressed', String(selected));
      }
    });

    const actions = playerSeat.querySelector('.play-actions');
    const play = actions?.querySelector('.play-selected');
    const hint = actions?.querySelector('.selection-hint');
    if (!actions || !play) return;

    actions.classList.toggle('visible', localSelected.length > 0);
    play.disabled = localSelected.length === 0;
    const playText = localSelected.length > 1 ? `PLAY ${localSelected.length}` : 'PLAY';
    if (play.textContent !== playText) play.textContent = playText;
    if (hint) {
      const hintText = localSelected.length > 1 ? `${localSelected.length} matching cards` : 'Selected';
      if (hint.textContent !== hintText) hint.textContent = hintText;
    }
  }

  // Capture client interactions before the normal handlers. A card selection has
  // no shared-game meaning until PLAY is pressed, so selecting does not render or publish.
  playerSeat.addEventListener('click', (event) => {
    if (!isOnlineClientTurn()) return;

    const card = event.target.closest('.hand button.card');
    if (card) {
      event.preventDefault();
      event.stopImmediatePropagation();

      const buttons = handButtons();
      const index = buttons.indexOf(card);
      const chosen = state.players[state.viewer]?.hand?.[index];
      if (index < 0 || !chosen) return;

      if (localSelected.includes(index)) {
        localSelected = localSelected.filter((item) => item !== index);
        if (!localSelected.length) localRank = null;
      } else if (localRank && chosen.rank !== localRank) {
        localSelected = [index];
        localRank = chosen.rank;
      } else {
        localSelected.push(index);
        localSelected.sort((a, b) => a - b);
        localRank = chosen.rank;
      }

      paintSelection();
      return;
    }

    const play = event.target.closest('.play-selected');
    if (play && localSelected.length) {
      // Own the client PLAY click completely. Relying on the old button listener
      // to run after this capture handler proved unreliable in multiplayer.
      event.preventDefault();
      event.stopImmediatePropagation();
      state.selected = [...localSelected];
      localSelected = [];
      localRank = null;
      playSelected(state.viewer);
      return;
    }

    if (event.target.closest('.pickup-pile, .finish-turn')) clearLocalSelection();
  }, true);

  // Shared-state updates rebuild the hand. Hook the game renderer once and repaint
  // afterwards. Unlike MutationObserver, this cannot trigger itself via DOM writes.
  const renderBeforeClientSelection = render;
  render = function renderWithClientSelection() {
    renderBeforeClientSelection();
    paintSelection();
  };

  paintSelection();
})();
