// Makes an active multiplayer room behave like a lobby instead of a second join form.
// Deliberately avoids MutationObserver: this UI writes to the same DOM it reads,
// so observing those writes can create a self-triggering render loop.
(() => {
  function setText(el, text) {
    if (el && el.textContent !== text) el.textContent = text;
  }

  function setHidden(el, hidden) {
    if (!el) return;
    const has = el.classList.contains('multiplayer-hidden');
    if (hidden && !has) el.classList.add('multiplayer-hidden');
    else if (!hidden && has) el.classList.remove('multiplayer-hidden');
  }

  function reconcileLobbyUi() {
    const mp = window.ShitHeadMultiplayer;
    const dialog = document.querySelector('.multiplayer-dialog');
    if (!mp || !dialog) return;

    const status = mp.status;
    const grid = dialog.querySelector('.multiplayer-grid');
    const roomCard = dialog.querySelector('#mpRoomCard');
    const error = dialog.querySelector('#mpError');
    if (!grid || !roomCard || !error) return;

    const online = status.role !== 'local' && !!status.roomCode;
    setHidden(grid, online);

    let actions = roomCard.querySelector('.room-lobby-actions');
    if (!actions) {
      actions = document.createElement('div');
      actions.className = 'room-lobby-actions';
      const primary = document.createElement('button');
      primary.type = 'button';
      primary.className = 'room-lobby-primary';
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'room-lobby-close';
      close.textContent = 'Close';
      close.addEventListener('click', () => dialog.close());
      actions.append(primary, close);
      roomCard.append(actions);
    }

    if (!online) {
      setHidden(actions, true);
      return;
    }

    if (error.textContent) error.textContent = '';
    setHidden(actions, false);

    const primary = actions.querySelector('.room-lobby-primary');
    const players = Array.isArray(status.players) ? status.players : [];
    const allThree = ['Oliver', 'Dan', 'Chris'].every((name) => players.includes(name));
    const inLobby = typeof state !== 'undefined' && state.phase === 'lobby';

    if (!inLobby) {
      setHidden(primary, true);
      return;
    }

    setHidden(primary, false);
    if (status.role === 'host') {
      if (primary.disabled === allThree) primary.disabled = !allThree;
      setText(primary, allThree ? 'START GAME' : `WAITING ${players.length}/3`);
      primary.onclick = () => {
        if (!allThree) return;
        mp.startGame();
        dialog.close();
      };
    } else {
      if (!primary.disabled) primary.disabled = true;
      setText(primary, 'WAITING FOR HOST');
      primary.onclick = null;
    }
  }

  reconcileLobbyUi();
  const timer = window.setInterval(reconcileLobbyUi, 250);
  window.addEventListener('pagehide', () => window.clearInterval(timer), { once: true });
})();
