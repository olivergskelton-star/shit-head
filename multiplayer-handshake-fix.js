// Keeps the room UI honest during PeerJS join attempts.
// Uses a small timer rather than watching and rewriting the same DOM tree.
(() => {
  function reconcile() {
    const error = document.querySelector('#mpError');
    const status = document.querySelector('#mpRoomStatus');
    const players = document.querySelector('#mpPlayers');
    if (!error || !status || !players) return;

    const failed = /could not join that room|connection to the host was lost/i.test(error.textContent || '');
    if (!failed) return;

    const message = 'Not connected — check the room code and make sure the host browser is still open.';
    if (status.textContent !== message) status.textContent = message;
    players.querySelectorAll('.room-player').forEach((pill) => {
      if (pill.classList.contains('connected')) pill.classList.remove('connected');
      const clean = pill.textContent.replace(/\s*✓\s*$/, '');
      if (pill.textContent !== clean) pill.textContent = clean;
    });
  }

  reconcile();
  const timer = window.setInterval(reconcile, 300);
  window.addEventListener('pagehide', () => window.clearInterval(timer), { once: true });
})();
