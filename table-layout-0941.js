// Presentation only: keep the engine's card elements and event handlers intact.
(() => {
  const controls = document.querySelector('.controls');
  const menu = document.createElement('dialog');
  menu.id = 'tableMenu';
  menu.className = 'table-menu';
  menu.setAttribute('aria-labelledby', 'tableMenuTitle');
  menu.innerHTML = `<header><h2 id="tableMenuTitle">Your table</h2><button type="button" id="closeTableMenu" aria-label="Close table menu">Close</button></header>
    <div class="table-menu-settings"></div>
    <details><summary>Scores &amp; Shithead probabilities</summary><div id="tableMenuScores"></div></details>
    <div class="table-menu-info"></div>`;
  document.body.append(menu);
  const settings = menu.querySelector('.table-menu-settings');
  [themeSelect.closest('label'), viewerSelect.closest('label'), document.querySelector('.direction-control'), document.querySelector('#howToPlayBtn')].filter(Boolean).forEach(el => settings.append(el));
  // The ticker inserts its own content before the original footer deal button.
  // Keep that anchor in place and forward the menu action to its existing handler.
  const deal = document.createElement('button');
  deal.type = 'button'; deal.id = 'menuNewDeal'; deal.textContent = 'New deal';
  deal.onclick = () => { if (!newGameBtn.disabled) { newGameBtn.click(); menu.close(); } };
  settings.append(deal);
  [document.querySelector('#buildBadge'), document.querySelector('#offlineStatus')].filter(Boolean).forEach(el => menu.querySelector('.table-menu-info').append(el));
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.id = 'tableMenuButton';
  trigger.textContent = 'Menu';
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-controls', menu.id);
  controls.append(trigger);
  trigger.onclick = () => {
    deal.disabled = newGameBtn.disabled;
    viewerSelect.closest('label').hidden = viewerSelect.disabled;
    updateMenuScores(); menu.showModal();
  };
  menu.querySelector('#closeTableMenu').onclick = () => menu.close();
  menu.addEventListener('click', event => {
    if (event.target === menu) menu.close();
  });
  document.querySelector('#howToPlayBtn').addEventListener('click', () => menu.close(), true);
  newGameBtn.addEventListener('click', () => menu.close());

  const turn = document.createElement('div');
  turn.className = 'mobile-turn-status';
  turn.setAttribute('role', 'status');
  document.querySelector('.centre-zone').before(turn);

  function updateMenuScores() {
    const scores = menu.querySelector('#tableMenuScores');
    scores.replaceChildren();
    document.querySelectorAll('.seat:not([hidden]) .player-notepad').forEach(pad => {
      const row = document.createElement('p');
      row.textContent = `${pad.querySelector('.notepad-name')?.textContent || ''} · Score ${pad.querySelector('.notepad-score .notepad-value')?.textContent || '0'} · Shithead ${pad.querySelector('.notepad-risk .notepad-value')?.textContent || '—'}`;
      scores.append(row);
    });
  }

  function decorateLayout() {
    deal.disabled = newGameBtn.disabled;
    const count = PLAYER_NAMES.length;
    document.body.dataset.playerCount = String(count);
    const seats = [opponentLeft, opponentTop, opponentRight].filter(seat => seat && !seat.hidden);
    document.querySelector('#table').style.setProperty('--opponent-count', Math.max(1, seats.length));
    seats.forEach((seat, index) => {
      seat.style.setProperty('--mobile-seat-column', index + 1);
      const player = seat.querySelector('.player-notepad')?.dataset.player;
      const badge = seat.querySelector('.opponent-hand-count');
      if (badge && player) badge.dataset.mobileCount = `${state.players[player]?.hand.length || 0} cards`;
    });
    const hand = playerSeat.querySelector('.hand');
    const n = state.players[state.viewer]?.hand.length || 0;
    const label = document.createElement('span');
    label.className = 'mobile-hand-label';
    label.textContent = n ? `Your hand · ${n} card${n === 1 ? '' : 's'}` : 'Your hand is empty';
    hand?.before(label);
    const actions = playerSeat.querySelector('.play-actions');
    const sort = playerSeat.querySelector('.sort-hand');
    // Grid positions below work with existing direct children at every phase.
    if (sort) sort.hidden = n === 0;
    if (actions) actions.setAttribute('aria-label', state.phase === 'setup' ? 'Arrange your cards and get ready' : 'Your turn actions');
    const current = state.currentPlayer === state.viewer ? 'Your turn' : `${publicName(state.currentPlayer)}’s turn`;
    turn.textContent = state.phase === 'setup' ? 'Arrange your cards, then press Ready'
      : state.phase === 'lobby' ? 'Invite your friends · up to four players'
      : state.phase === 'gameover' ? (state.lastMessage || 'Round complete')
      : `${current}${state.followUpRank ? ' · add matching cards or finish turn' : ''}`;
    if (menu.open) updateMenuScores();
  }
  const previousRender = render;
  render = function renderWithCompactTable() { previousRender(); decorateLayout(); };
  render();
})();
