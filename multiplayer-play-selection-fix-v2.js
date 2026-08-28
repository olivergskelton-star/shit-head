// 0.9.15 multiplayer selection layer.
// Selection is private to each browser. Both host and clients use the same card-ref
// model; the host executes locally, clients send the refs/actions to the host.
(() => {
  let localRefs = [];
  let awaitingHost = false;

  function tablePlay() {
    return window.ShitHeadTablePlay;
  }

  function onlineRole() {
    return window.ShitHeadMultiplayer?.status?.role || 'local';
  }

  function isOnlineTurn() {
    const role = onlineRole();
    return role !== 'local'
      && state.phase === 'play'
      && state.currentPlayer === state.viewer;
  }

  function handButtons() {
    return [...playerSeat.querySelectorAll('.hand button.card')];
  }

  function faceButtons() {
    return [...playerSeat.querySelectorAll('.self-face-row button.table-play-card[data-slot-index]')];
  }

  function refForCard(card) {
    if (card?.dataset?.playZone === 'faceUp') {
      const index = Number(card.dataset.slotIndex);
      return Number.isInteger(index) ? { zone: 'faceUp', index } : null;
    }
    const index = handButtons().indexOf(card);
    return index >= 0 ? { zone: 'hand', index } : null;
  }

  function validLocalRefs() {
    const api = tablePlay();
    if (!api?.cardForRef) return [];
    return localRefs.filter((ref) => api.cardForRef(state.viewer, ref));
  }

  function clearLocalSelection() {
    localRefs = [];
    if (Array.isArray(state.selected)) state.selected = [];
  }

  function otherTurnActionVisible(actions) {
    const pickup = actions?.querySelector('.pickup-pile');
    const finish = actions?.querySelector('.finish-turn');
    return !!((pickup && !pickup.hidden && !pickup.disabled) || (finish && !finish.hidden && !finish.disabled));
  }

  function isSelected(zone, index) {
    return localRefs.some((ref) => ref.zone === zone && ref.index === index);
  }

  function paintSelection() {
    if (!isOnlineTurn()) {
      awaitingHost = false;
      clearLocalSelection();
      return;
    }

    localRefs = validLocalRefs();
    state.selected = localRefs.filter((ref) => ref.zone === 'hand').map((ref) => ref.index);

    handButtons().forEach((button, index) => {
      const selected = isSelected('hand', index);
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });

    faceButtons().forEach((button) => {
      const index = Number(button.dataset.slotIndex);
      const selected = Number.isInteger(index) && isSelected('faceUp', index);
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });

    const actions = playerSeat.querySelector('.play-actions');
    const play = actions?.querySelector('.play-selected');
    const hint = actions?.querySelector('.selection-hint');
    const pickup = actions?.querySelector('.pickup-pile');
    const finish = actions?.querySelector('.finish-turn');
    if (!actions || !play) return;

    const showPlay = localRefs.length > 0 || awaitingHost;
    actions.classList.toggle('visible', showPlay || otherTurnActionVisible(actions));
    play.hidden = false;
    play.disabled = awaitingHost || localRefs.length === 0;
    play.textContent = awaitingHost
      ? 'PLAYING…'
      : localRefs.length > 1
        ? `PLAY ${localRefs.length}`
        : 'PLAY';

    if (pickup && awaitingHost) pickup.disabled = true;
    if (finish && awaitingHost) finish.disabled = true;

    if (hint) {
      hint.hidden = false;
      hint.textContent = awaitingHost
        ? 'Waiting for host'
        : localRefs.length > 1
          ? `${localRefs.length} matching cards selected`
          : 'Selected';
    }
  }

  function failSend(message) {
    awaitingHost = false;
    statusText.textContent = message;
    paintSelection();
  }

  function playBlind(slotIndex) {
    const role = onlineRole();
    if (role === 'host') {
      tablePlay()?.playFaceDown?.(state.viewer, slotIndex);
      window.ShitHeadMultiplayer?.publishState?.();
      return;
    }

    const sent = window.ShitHeadAuthoritativePlay?.sendBlind?.(state.viewer, slotIndex);
    if (!sent) {
      failSend('Could not send the blind card to the host. Check the room connection.');
      return;
    }
    awaitingHost = true;
    clearLocalSelection();
    paintSelection();
  }

  function doTurnAction(action) {
    const role = onlineRole();
    clearLocalSelection();

    if (role === 'host') {
      if (action === 'pickup') pickupDiscard(state.viewer);
      else if (action === 'finish') finishTurn(state.viewer);
      window.ShitHeadMultiplayer?.publishState?.();
      return;
    }

    const sent = window.ShitHeadAuthoritativePlay?.sendTurnAction?.(state.viewer, action);
    if (!sent) {
      failSend(`Could not send ${action === 'pickup' ? 'PICK UP' : 'FINISH TURN'} to the host. Check the room connection.`);
      return;
    }
    awaitingHost = true;
    paintSelection();
  }

  playerSeat.addEventListener('click', (event) => {
    if (!isOnlineTurn() || awaitingHost) return;

    const sort = event.target.closest('.sort-hand');
    if (sort) {
      clearLocalSelection();
      return;
    }

    const pickup = event.target.closest('.pickup-pile');
    if (pickup && !pickup.disabled && !pickup.hidden) {
      event.preventDefault();
      event.stopImmediatePropagation();
      doTurnAction('pickup');
      return;
    }

    const finish = event.target.closest('.finish-turn');
    if (finish && !finish.disabled && !finish.hidden) {
      event.preventDefault();
      event.stopImmediatePropagation();
      doTurnAction('finish');
      return;
    }

    const blind = event.target.closest('.self-face-row button.table-blind-card[data-slot-index]');
    if (blind) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const slotIndex = Number(blind.dataset.slotIndex);
      if (Number.isInteger(slotIndex)) playBlind(slotIndex);
      return;
    }

    const card = event.target.closest('.hand button.card, .self-face-row button.table-play-card[data-slot-index]');
    if (card) {
      event.preventDefault();
      event.stopImmediatePropagation();

      const ref = refForCard(card);
      if (!ref || !tablePlay()?.toggleRefs) return;
      const result = tablePlay().toggleRefs(state.viewer, localRefs, ref);
      localRefs = result.refs || localRefs;
      if (result.message) statusText.textContent = result.message;
      paintSelection();
      return;
    }

    const play = event.target.closest('.play-selected');
    if (play && localRefs.length) {
      event.preventDefault();
      event.stopImmediatePropagation();

      const refs = localRefs.map((ref) => ({ zone: ref.zone, index: ref.index }));
      const role = onlineRole();
      clearLocalSelection();

      if (role === 'host') {
        tablePlay()?.playRefs?.(state.viewer, refs);
        window.ShitHeadMultiplayer?.publishState?.();
        return;
      }

      const sent = window.ShitHeadAuthoritativePlay?.send?.(state.viewer, refs);
      if (!sent) {
        failSend('Could not send the play to the host. Check the room connection.');
        return;
      }

      awaitingHost = true;
      paintSelection();
    }
  }, true);

  const renderBeforeOnlineSelection = render;
  render = function renderWithOnlineSelection0915() {
    renderBeforeOnlineSelection();
    if (awaitingHost) {
      awaitingHost = false;
      clearLocalSelection();
    }
    paintSelection();
  };

  paintSelection();
})();