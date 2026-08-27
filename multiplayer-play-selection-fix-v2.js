// Multiplayer client card selection.
// Selection stays private on the client; PLAY sends an intent to the HOST, which
// executes the real game engine and broadcasts the authoritative result.
(() => {
  let localSelected = [];
  let localRank = null;
  let awaitingHost = false;

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
      awaitingHost = false;
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

    actions.classList.toggle('visible', localSelected.length > 0 || awaitingHost);
    play.disabled = awaitingHost || localSelected.length === 0;
    const playText = awaitingHost
      ? 'PLAYING…'
      : localSelected.length > 1
        ? `PLAY ${localSelected.length}`
        : 'PLAY';
    if (play.textContent !== playText) play.textContent = playText;
    if (hint) {
      const hintText = awaitingHost
        ? 'Waiting for host'
        : localSelected.length > 1
          ? `${localSelected.length} matching cards`
          : 'Selected';
      if (hint.textContent !== hintText) hint.textContent = hintText;
    }
  }

  playerSeat.addEventListener('click', (event) => {
    if (!isOnlineClientTurn() || awaitingHost) return;

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
      event.preventDefault();
      event.stopImmediatePropagation();

      const indices = [...localSelected];
      const sent = window.ShitHeadAuthoritativePlay?.send?.(state.viewer, indices);
      if (!sent) {
        statusText.textContent = 'Could not send the play to the host. Check the room connection.';
        return;
      }

      awaitingHost = true;
      clearLocalSelection();
      paintSelection();
      return;
    }
  }, true);

  // A render after PLAY is the host's authoritative response (successful move or
  // rejection). Release the temporary waiting state and paint whatever the host sent.
  const renderBeforeClientSelection = render;
  render = function renderWithClientSelection() {
    renderBeforeClientSelection();
    if (awaitingHost) awaitingHost = false;
    paintSelection();
  };

  paintSelection();
})();
