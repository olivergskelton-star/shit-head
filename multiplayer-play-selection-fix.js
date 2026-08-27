// Multiplayer client selection fix.
// Card selection is UI-only state and must not be wiped by the host echoing the
// shared game snapshot back to the client before PLAY is pressed.
(() => {
  let localSelected = [];
  let localRank = null;

  function isOnlineClientTurn() {
    const mp = window.ShitHeadMultiplayer;
    if (!mp || mp.status?.role !== 'client') return false;
    return state.phase === 'play' && state.currentPlayer === state.viewer;
  }

  function handButtons() {
    return [...playerSeat.querySelectorAll('.hand button.card')];
  }

  function clearLocalSelection() {
    localSelected = [];
    localRank = null;
    if (Array.isArray(state.selected)) state.selected = [];
  }

  function validSelection() {
    const hand = state.players[state.viewer]?.hand || [];
    localSelected = localSelected.filter((index) => Number.isInteger(index) && index >= 0 && index < hand.length);
    if (!localSelected.length) localRank = null;
    return hand;
  }

  function paintSelection() {
    if (!isOnlineClientTurn()) {
      clearLocalSelection();
      return;
    }

    const hand = validSelection();
    state.selected = [...localSelected];

    handButtons().forEach((button, index) => {
      const selected = localSelected.includes(index);
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });

    const actions = playerSeat.querySelector('.play-actions');
    const play = actions?.querySelector('.play-selected');
    const hint = actions?.querySelector('.selection-hint');
    if (!actions || !play) return;

    if (localSelected.length) actions.classList.add('visible');
    play.disabled = localSelected.length === 0;
    play.textContent = localSelected.length > 1 ? `PLAY ${localSelected.length}` : 'PLAY';
    if (hint) hint.textContent = localSelected.length > 1 ? `${localSelected.length} matching cards` : 'Selected';
  }

  // Intercept hand clicks on clients. The normal handler calls render(), which
  // publishes a snapshot; the host then echoes it back and clears state.selected.
  // Keep the selection local instead and only hand it to the engine on PLAY.
  playerSeat.addEventListener('click', (event) => {
    if (!isOnlineClientTurn()) return;

    const card = event.target.closest('.hand button.card');
    if (card) {
      event.preventDefault();
      event.stopImmediatePropagation();

      const buttons = handButtons();
      const index = buttons.indexOf(card);
      if (index < 0) return;
      const hand = state.players[state.viewer]?.hand || [];
      const chosen = hand[index];
      if (!chosen) return;

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
      // The existing PLAY listener runs after this capture phase and uses
      // state.selected, so populate it immediately before handing control back.
      state.selected = [...localSelected];
      localSelected = [];
      localRank = null;
      return;
    }

    if (event.target.closest('.pickup-pile, .finish-turn')) clearLocalSelection();
  }, true);

  // Shared state renders replace the hand DOM. Repaint the client's private
  // selection after every such render so a host echo cannot make it disappear.
  const observer = new MutationObserver(() => {
    if (!isOnlineClientTurn()) {
      clearLocalSelection();
      return;
    }
    queueMicrotask(paintSelection);
  });
  observer.observe(playerSeat, { childList: true, subtree: true });

  paintSelection();
})();
