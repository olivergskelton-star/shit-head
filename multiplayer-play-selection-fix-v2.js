// Load the core table-card end game using the same visible build number.
(() => {
  if (window.ShitHeadTablePlay) return;
  const script = document.createElement('script');
  const build = encodeURIComponent(window.SHITHEAD_BUILD || 'dev');
  script.src = `table-card-play.js?v=${build}`;
  document.body.append(script);
})();

// Multiplayer online card selection across hand, face-up table cards and blind cards.
// Host executes locally; clients send intent to the host.
(() => {
  let localSelected = [];
  let localRank = null;
  let localZone = null;
  let awaitingHost = false;

  function onlineRole() {
    return window.ShitHeadMultiplayer?.status?.role || 'local';
  }

  function isOnlineTurn() {
    const role = onlineRole();
    return role !== 'local'
      && state.phase === 'play'
      && state.currentPlayer === state.viewer;
  }

  function currentZone() {
    return window.ShitHeadTablePlay?.currentZone?.(state.viewer)
      || (state.players[state.viewer]?.hand?.length ? 'hand' : 'out');
  }

  function sourceFor(zone) {
    const player = state.players[state.viewer];
    if (!player) return [];
    if (zone === 'faceUp') return player.faceUp;
    if (zone === 'faceDown') return player.faceDown;
    return player.hand;
  }

  function selectableButtons(zone) {
    if (zone === 'faceUp') return [...playerSeat.querySelectorAll('.self-face-row button.card[data-play-zone="faceUp"]')];
    if (zone === 'hand') return [...playerSeat.querySelectorAll('.hand button.card')];
    return [];
  }

  function clearLocalSelection() {
    localSelected = [];
    localRank = null;
    localZone = null;
    if (Array.isArray(state.selected)) state.selected = [];
  }

  function otherTurnActionVisible(actions) {
    const pickup = actions?.querySelector('.pickup-pile');
    const finish = actions?.querySelector('.finish-turn');
    return !!((pickup && !pickup.hidden && !pickup.disabled) || (finish && !finish.hidden && !finish.disabled));
  }

  function paintSelection() {
    if (!isOnlineTurn()) {
      awaitingHost = false;
      clearLocalSelection();
      return;
    }

    const zone = currentZone();
    if (localZone && localZone !== zone) clearLocalSelection();

    const source = sourceFor(zone);
    localSelected = localSelected.filter((index) => Number.isInteger(index) && index >= 0 && index < source.length);
    if (!localSelected.length) {
      localRank = null;
      localZone = null;
    }
    state.selected = [...localSelected];

    selectableButtons(zone).forEach((button, index) => {
      const selected = localSelected.includes(index) && (!localZone || localZone === zone);
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });

    const actions = playerSeat.querySelector('.play-actions');
    const play = actions?.querySelector('.play-selected');
    const hint = actions?.querySelector('.selection-hint');
    if (!actions || !play) return;

    const showPlay = (zone === 'hand' || zone === 'faceUp') && (localSelected.length > 0 || awaitingHost);
    actions.classList.toggle('visible', showPlay || otherTurnActionVisible(actions));
    play.hidden = zone === 'faceDown' || zone === 'out';
    play.disabled = awaitingHost || localSelected.length === 0;

    const playText = awaitingHost
      ? 'PLAYING…'
      : localSelected.length > 1
        ? `PLAY ${localSelected.length}`
        : 'PLAY';
    if (play.textContent !== playText) play.textContent = playText;

    if (hint) {
      hint.hidden = zone === 'faceDown' || zone === 'out';
      const hintText = awaitingHost
        ? 'Waiting for host'
        : localSelected.length > 1
          ? `${localSelected.length} matching cards`
          : 'Selected';
      if (hint.textContent !== hintText) hint.textContent = hintText;
    }
  }

  function sendBlind(index) {
    const role = onlineRole();
    if (role === 'host') {
      window.ShitHeadTablePlay?.playFaceDown?.(state.viewer, index);
      window.ShitHeadMultiplayer?.publishState?.();
      return;
    }

    const sent = window.ShitHeadAuthoritativePlay?.sendBlind?.(state.viewer, index);
    if (!sent) {
      statusText.textContent = 'Could not send the blind card to the host. Check the room connection.';
      return;
    }
    awaitingHost = true;
    statusText.textContent = 'Turning a face-down card… waiting for host.';
  }

  playerSeat.addEventListener('click', (event) => {
    if (!isOnlineTurn() || awaitingHost) return;

    const zone = currentZone();
    const blind = event.target.closest('.self-face-row button.table-blind-card[data-play-zone="faceDown"]');
    if (blind && zone === 'faceDown') {
      event.preventDefault();
      event.stopImmediatePropagation();
      const index = Number(blind.dataset.playIndex);
      if (Number.isInteger(index)) sendBlind(index);
      return;
    }

    const card = event.target.closest('.hand button.card, .self-face-row button.card[data-play-zone="faceUp"]');
    if (card && (zone === 'hand' || zone === 'faceUp')) {
      const cardZone = card.dataset.playZone === 'faceUp' ? 'faceUp' : 'hand';
      if (cardZone !== zone) return;

      event.preventDefault();
      event.stopImmediatePropagation();

      const buttons = selectableButtons(zone);
      const index = buttons.indexOf(card);
      const chosen = sourceFor(zone)[index];
      if (index < 0 || !chosen) return;

      if (localZone && localZone !== zone) clearLocalSelection();
      localZone = zone;

      if (state.followUpRank && chosen.rank !== state.followUpRank) {
        statusText.textContent = `Only another ${state.followUpRank} can be added before the turn passes.`;
        return;
      }

      if (localSelected.includes(index)) {
        localSelected = localSelected.filter((item) => item !== index);
        if (!localSelected.length) {
          localRank = null;
          localZone = null;
        }
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
    if (play && localSelected.length && (localZone === 'hand' || localZone === 'faceUp')) {
      event.preventDefault();
      event.stopImmediatePropagation();

      const indices = [...localSelected];
      const playZone = localZone;
      const role = onlineRole();

      if (role === 'host') {
        clearLocalSelection();
        state.selected = indices;
        state.selectedZone = playZone;
        playSelected(state.viewer);
        window.ShitHeadMultiplayer?.publishState?.();
        return;
      }

      const sent = window.ShitHeadAuthoritativePlay?.send?.(state.viewer, indices, playZone);
      if (!sent) {
        statusText.textContent = 'Could not send the play to the host. Check the room connection.';
        return;
      }

      awaitingHost = true;
      clearLocalSelection();
      paintSelection();
    }
  }, true);

  const renderBeforeOnlineSelection = render;
  render = function renderWithOnlineSelection() {
    renderBeforeOnlineSelection();
    if (awaitingHost) awaitingHost = false;
    paintSelection();
  };

  paintSelection();
})();
