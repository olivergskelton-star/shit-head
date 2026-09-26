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

  const turnMessage = document.createElement('span');
  turn.append(turnMessage);
  const roundActions = document.createElement('div');
  roundActions.className = 'round-actions';
  roundActions.hidden = true;
  const again = document.createElement('button');
  again.id = 'roundDealAgain'; again.type = 'button'; again.textContent = 'Deal again';
  const waiting = document.createElement('span');
  waiting.textContent = 'Waiting for the host to deal again';
  roundActions.append(again, waiting);
  turn.append(roundActions);

  const soloFinish = document.createElement('div');
  soloFinish.className = 'solo-finish-actions'; soloFinish.hidden = true;
  const finishButton = document.createElement('button');
  finishButton.type = 'button'; finishButton.id = 'soloFinishRound';
  finishButton.onclick = () => window.ShitHeadSolo?.finishRound();
  soloFinish.append(finishButton); turn.append(soloFinish);

  const round = document.createElement('dialog');
  round.id = 'roundOverDialog'; round.className = 'round-over';
  round.setAttribute('aria-labelledby', 'roundOverTitle');
  round.innerHTML = `<h2 id="roundOverTitle">Round over</h2><p id="roundOverResult"></p>
    <p id="roundOverHint"></p><div class="round-over-actions">
    <button type="button" id="roundNewDeal" autofocus>New deal</button>
    <button type="button" id="roundQuit">Quit</button></div>
    <small>Quit returns to the start screen and leaves any online room.</small>`;
  document.body.append(round);
  const next = round.querySelector('#roundNewDeal');
  let offeredRound = false;
  let scheduledRound = false;
  function canDealRound() {
    const role = window.ShitHeadMultiplayer?.status?.role;
    return state.phase === 'gameover' && (!role || role === 'local' || role === 'host');
  }
  function nextRound() {
    if (!canDealRound() || newGameBtn.disabled) return;
    round.close(); newGameBtn.click();
  }
  again.onclick = nextRound;
  next.onclick = nextRound;
  const start = document.createElement('dialog');
  start.id = 'gameStartDialog'; start.className = 'round-over game-start';
  start.setAttribute('aria-labelledby', 'gameStartTitle');
  start.innerHTML = `<p class="eyebrow">Red wine &amp; cards</p><h2 id="gameStartTitle">S**t Head</h2>
    <p>Pull up a chair.</p><div class="round-over-actions">
    <button type="button" id="startSolo">Play solo</button>
    <button type="button" id="startOnline">Play online</button></div>
    <small>Solo against three CPUs, or invite up to three friends.</small>`;
  document.body.append(start);
  let atStart = false;
  round.querySelector('#roundQuit').onclick = () => {
    atStart = true;
    window.ShitHeadSolo?.stop();
    if (window.ShitHeadMultiplayer?.status.role !== 'local') window.ShitHeadMultiplayer?.disconnect();
    round.close();
    document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
    start.showModal();
  };
  start.querySelector('#startSolo').onclick = () => {
    start.close(); document.querySelector('#soloPlay').click();
  };
  start.querySelector('#startOnline').onclick = () => {
    start.close(); document.querySelector('.multiplayer-trigger').click();
  };
  // Keep the start screen as the destination when a setup sheet is cancelled.
  start.addEventListener('cancel', event => event.preventDefault());
  document.addEventListener('close', () => {
    if (atStart && window.ShitHeadSolo?.active) {
      atStart = false; offeredRound = false; updateRound();
    }
    if (atStart && !document.querySelector('dialog[open]')) start.showModal();
  }, true);
  function updateRound() {
    const finished = state.phase === 'gameover';
    document.body.classList.toggle('round-finished', finished);
    roundActions.hidden = !finished;
    if (!finished) { atStart = false; if (start.open) start.close(); offeredRound = false; if (round.open) round.close(); return; }
    const allowed = canDealRound();
    again.hidden = next.hidden = !allowed;
    waiting.hidden = allowed;
    round.querySelector('#roundOverResult').textContent = state.shitHead
      ? `${publicName(state.shitHead)} is the Shit Head. Score: ${state.scores[state.shitHead] || 0}.`
      : 'All done for this round.';
    round.querySelector('#roundOverHint').textContent = allowed
      ? 'Another round? New deal keeps everyone’s scores.'
      : 'The host can deal the next round. Your scores are kept.';
    // Wait for the remaining render wrappers (including multiplayer) to finish.
    if (!offeredRound && !scheduledRound) {
      scheduledRound = true;
      setTimeout(() => {
        scheduledRound = false;
        if (state.phase !== 'gameover' || offeredRound || document.querySelector('dialog[open]')) return;
        offeredRound = true; round.showModal();
      }, 0);
    }
  }
  document.addEventListener('close', () => { if (state.phase === 'gameover' && !offeredRound) updateRound(); }, true);

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
    turnMessage.textContent = state.phase === 'setup' ? 'Arrange your cards, then press Ready'
      : state.phase === 'lobby' ? 'Invite your friends · up to four players'
      : state.phase === 'gameover' ? (state.lastMessage || 'Round complete')
      : `${current}${state.followUpRank ? ' · add matching cards or finish turn' : ''}`;
    const canFinish = !!window.ShitHeadSolo?.canFinishRound();
    const finishing = canFinish && window.ShitHeadSolo.finishing;
    document.body.classList.toggle('solo-player-out', canFinish);
    soloFinish.hidden = !canFinish;
    finishButton.textContent = finishing ? 'Finishing… · slow down' : 'Finish round »';
    finishButton.setAttribute('aria-pressed', String(finishing));
    if (canFinish) turnMessage.textContent = finishing
      ? 'Finishing the CPU turns at speed…'
      : 'You’re out! Watch the CPUs, or finish the round at speed.';
    updateRound();
    if (menu.open) updateMenuScores();
  }
  const previousRender = render;
  render = function renderWithCompactTable() { previousRender(); decorateLayout(); };
  render();
})();
