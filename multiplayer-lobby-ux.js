// Makes an active multiplayer room behave like a lobby instead of a second join form.
(() => {
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
    grid.classList.toggle('multiplayer-hidden', online);

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
      actions.classList.add('multiplayer-hidden');
      return;
    }

    // Once the host has acknowledged the room, old join-form validation is irrelevant.
    error.textContent = '';
    actions.classList.remove('multiplayer-hidden');

    const primary = actions.querySelector('.room-lobby-primary');
    const players = Array.isArray(status.players) ? status.players : [];
    const allThree = ['Oliver', 'Dan', 'Chris'].every((name) => players.includes(name));
    const inLobby = typeof state !== 'undefined' && state.phase === 'lobby';

    if (!inLobby) {
      primary.classList.add('multiplayer-hidden');
      return;
    }

    primary.classList.remove('multiplayer-hidden');
    if (status.role === 'host') {
      primary.disabled = !allThree;
      primary.textContent = allThree ? 'START GAME' : `WAITING ${players.length}/3`;
      primary.onclick = () => {
        if (!allThree) return;
        mp.startGame();
        dialog.close();
      };
    } else {
      primary.disabled = true;
      primary.textContent = 'WAITING FOR HOST';
      primary.onclick = null;
    }
  }

  const observer = new MutationObserver(reconcileLobbyUi);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
  reconcileLobbyUi();
})();
