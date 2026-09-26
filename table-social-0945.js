// Seat feedback is ephemeral UI. Only public engine outcomes and fixed reactions
// reach this layer; drawing, swapping and hand contents never do.
(() => {
  const reactions = Object.freeze({ laugh: '😂', wow: '😮', ouch: '😬', cheers: '🍻', clap: '👏' });
  const labels = { laugh: 'Laugh', wow: 'Wow', ouch: 'Ouch', cheers: 'Cheers', clap: 'Well played' };
  const bubbles = new Map();
  let seenEvent = null, room = '', lastTurn = '', cooldownUntil = 0, cooldownTimer;
  const live = document.createElement('span');
  live.className = 'table-social-live'; live.setAttribute('role', 'status');
  document.body.append(live);
  const trigger = document.createElement('button');
  trigger.type = 'button'; trigger.id = 'seatReact'; trigger.textContent = 'React ☺';
  trigger.setAttribute('aria-haspopup', 'dialog'); trigger.setAttribute('aria-controls', 'seatReactions');
  const picker = document.createElement('dialog');
  picker.id = 'seatReactions'; picker.className = 'seat-reactions';
  picker.setAttribute('aria-labelledby', 'seatReactionsTitle');
  picker.innerHTML = '<h2 id="seatReactionsTitle">Table reactions</h2><div class="reaction-options"></div><button type="button" class="reaction-close">Close</button>';
  document.body.append(picker);
  picker.querySelector('.reaction-close').onclick = () => picker.close();
  picker.addEventListener('click', e => { if (e.target === picker) picker.close(); });
  trigger.onclick = () => { if (online() && Date.now() >= cooldownUntil) picker.showModal(); };
  for (const [id, emoji] of Object.entries(reactions)) {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = emoji; button.setAttribute('aria-label', labels[id]);
    button.dataset.reaction = id;
    button.onclick = () => {
      if (Date.now() < cooldownUntil || !window.ShitHeadMultiplayer?.sendReaction(id)) return;
      cooldownUntil = Date.now() + 2000; trigger.disabled = true; picker.close();
      clearTimeout(cooldownTimer);
      cooldownTimer = setTimeout(() => { trigger.disabled = false; }, 2000);
    };
    picker.querySelector('.reaction-options').append(button);
  }
  function online() { return ['play', 'gameover'].includes(state.phase) && ['host', 'client'].includes(window.ShitHeadMultiplayer?.status.role); }
  function paintBubbles() {
    document.querySelectorAll('.player-notepad').forEach(pad => {
      const bubble = bubbles.get(pad.dataset.player);
      if (bubble) pad.append(bubble.element);
    });
  }
  function flash(player, text, label = text) {
    if (!state.players[player]) return;
    const old = bubbles.get(player);
    if (old) { clearTimeout(old.timer); old.element.remove(); }
    const element = document.createElement('span');
    element.className = 'seat-callout'; element.textContent = text;
    element.setAttribute('aria-label', label);
    const timer = setTimeout(() => { element.remove(); bubbles.delete(player); }, 2800);
    bubbles.set(player, { element, timer }); paintBubbles();
    live.textContent = `${publicName(player)}: ${label}`;
  }
  function clear() {
    for (const bubble of bubbles.values()) { clearTimeout(bubble.timer); bubble.element.remove(); }
    bubbles.clear(); seenEvent = state.tableEvent?.id;
    picker.close(); cooldownUntil = 0; clearTimeout(cooldownTimer); trigger.disabled = false;
  }
  function refresh() {
    const nextRoom = window.ShitHeadMultiplayer?.status.roomCode || '';
    if (nextRoom !== room) { clear(); room = nextRoom; }
    if (!online()) picker.close();
    trigger.hidden = !online();
    if (online()) playerSeat.append(trigger);
    const current = state.phase === 'play' ? state.currentPlayer : '';
    document.querySelectorAll('.player-notepad').forEach(pad => {
      pad.querySelector('.seat-turn-tag')?.remove();
      pad.removeAttribute('aria-current');
      const active = pad.dataset.player === current;
      pad.classList.toggle('turn-highlight', active);
      if (active) {
        pad.setAttribute('aria-current', 'true');
        const tag = document.createElement('span'); tag.className = 'seat-turn-tag';
        tag.textContent = current === state.viewer ? 'YOUR TURN' : 'TURN'; pad.append(tag);
      }
    });
    if (current !== lastTurn) {
      lastTurn = current;
      live.textContent = current ? (current === state.viewer ? 'Your turn' : `${publicName(current)}’s turn`) : '';
    }
    if (!['play', 'gameover'].includes(state.phase)) { clear(); return; }
    const event = state.tableEvent;
    if (event && event.id !== seenEvent) {
      seenEvent = event.id;
      // Don't replay an old callout on reconnect, reload, or solo resume.
      if (Date.now() - event.at >= 0 && Date.now() - event.at < 3000) {
        if (event.kind === 'ofcom') flash(event.player, 'Ofcom! 📺');
        else if (event.kind === 'pickup' && event.count >= 10) flash(event.player, `Monster pickup! ${event.count} cards`);
        else if (event.kind === 'burn') flash(event.player, 'Pile burned! 🔥');
      }
    }
    paintBubbles();
  }
  window.ShitHeadTableSocial = {
    isReaction: id => Object.hasOwn(reactions, id),
    receiveReaction(player, id) {
      if (online() && Object.hasOwn(reactions, id)) flash(player, reactions[id], labels[id]);
    },
    refresh, clear,
  };
  const previousRender = render;
  render = function renderSeatFeedback() { previousRender(); refresh(); };
  newGameBtn.addEventListener('click', clear);
  render();
})();
