// Keeps the room UI honest during PeerJS join attempts.
// The core multiplayer layer enters client mode before the host has acknowledged
// the requested seat, so a failed connection can otherwise look "connected".
(() => {
  function getEls() {
    return {
      error: document.querySelector('#mpError'),
      status: document.querySelector('#mpRoomStatus'),
      players: document.querySelector('#mpPlayers'),
      roomCard: document.querySelector('#mpRoomCard'),
    };
  }

  function reconcile() {
    const { error, status, players, roomCard } = getEls();
    if (!error || !status || !players || !roomCard) return;

    const failed = /could not join that room|connection to the host was lost/i.test(error.textContent || '');
    if (!failed) return;

    // A PeerJS failure means the host never acknowledged this seat. Do not leave
    // the optimistic pre-welcome UI claiming that the browser is connected.
    status.textContent = 'Not connected — check the room code and make sure the host browser is still open.';
    players.querySelectorAll('.room-player').forEach((pill) => {
      pill.classList.remove('connected');
      pill.textContent = pill.textContent.replace(/\s*✓\s*$/, '');
    });
  }

  const observer = new MutationObserver(reconcile);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  reconcile();
})();
