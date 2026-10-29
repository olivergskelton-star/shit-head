// Seat feedback is ephemeral UI. Only public engine outcomes and fixed reactions
// reach this layer; drawing, swapping and hand contents never do.
(() => {
  const reactions = Object.freeze({ laugh: '😂', wow: '😮', ouch: '😬', cheers: '🍻', clap: '👏' });
  const labels = { laugh: 'Laugh', wow: 'Wow', ouch: 'Ouch', cheers: 'Cheers', clap: 'Well played' };
  const bubbles = new Map();
  let seenEvent = null, room = '', lastTurn = '', cooldownUntil = 0, cooldownTimer;
  // Every browser derives these moments from the same public room snapshot.
  let knownOut = new Set(state.finishOrder || []), previousPhase = state.phase;
  let momentTimer = null, activeMoment = null;
  const moments = [];
  const celebration = document.createElement('aside');
  celebration.className = 'table-celebration';
  celebration.hidden = true;
  celebration.setAttribute('aria-label', 'Table announcement');
  const icon = document.createElement('span');
  icon.className = 'celebration-icon'; icon.setAttribute('aria-hidden', 'true');
  const copy = document.createElement('div');
  const headline = document.createElement('strong');
  headline.className = 'celebration-title';
  const detail = document.createElement('span');
  detail.className = 'celebration-detail';
  copy.append(headline, detail);
  const dismiss = document.createElement('button');
  dismiss.type = 'button'; dismiss.className = 'celebration-dismiss';
  dismiss.textContent = '\u00d7'; dismiss.setAttribute('aria-label', 'Dismiss table announcement');
  celebration.append(icon, copy, dismiss);
  document.body.append(celebration);
  function nextMoment() {
    clearTimeout(momentTimer);
    celebration.querySelectorAll('.celebration-confetti').forEach(el => el.remove());
    activeMoment = moments.shift() || null;
    celebration.hidden = !activeMoment;
    if (!activeMoment) return;
    const moment = activeMoment;
    celebration.dataset.kind = moment.kind;
    icon.textContent = moment.icon;
    headline.textContent = moment.title;
    detail.textContent = moment.detail;
    live.textContent = moment.title + '. ' + moment.detail;
    if (['ofcom', 'burn', 'out', 'winner', 'round'].includes(moment.kind)) {
      for (let i = 0; i < 16; i++) {
        const piece = document.createElement('i');
        piece.className = 'celebration-confetti';
        piece.setAttribute('aria-hidden', 'true');
        piece.style.setProperty('--piece', i);
        piece.style.setProperty('--drift', ((i * 47) % 260 - 130) + 'px');
        celebration.append(piece);
      }
    }
    // Restart entrance only for a new event, never on a routine table render.
    celebration.classList.remove('celebration-enter');
    void celebration.offsetWidth;
    celebration.classList.add('celebration-enter');
    momentTimer = setTimeout(nextMoment, moment.kind === 'round' ? 5200 : 3800);
  }
  function announce(kind, title, text, symbol) {
    if (moments.length >= 6) moments.shift();
    moments.push({kind, title, detail:text, icon:symbol});
    if (!activeMoment) nextMoment();
  }
  dismiss.onclick = nextMoment;
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
    clearTimeout(momentTimer); moments.length = 0; activeMoment = null; celebration.hidden = true;
    celebration.querySelectorAll('.celebration-confetti').forEach(el => el.remove());
    knownOut = new Set(state.finishOrder || []); previousPhase = state.phase;
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
        if (event.kind === 'ofcom') {
          flash(event.player, 'Ofcom! 📺');
          announce('ofcom', 'OFCOM! THREE EIGHTS!', publicName(event.player) + ' burns the pile — ' + event.count + ' cards gone!', '📺');
        }
        else if (event.kind === 'pickup' && event.count >= 10) {
          flash(event.player, `Monster pickup! ${event.count} cards`);
          announce('pickup', 'MONSTER PICKUP!', publicName(event.player) + ' takes the lot. ' + event.count + ' cards!', '😱');
        }
        else if (event.kind === 'burn') {
          flash(event.player, 'Pile burned! 🔥');
          announce('burn', 'BURN, BABY, BURN!', publicName(event.player) + ' clears ' + event.count + ' cards from the table!', '🔥');
        }
      }
    }
    const finishOrder = state.finishOrder || [];
    for (const player of finishOrder) {
      if (knownOut.has(player)) continue;
      knownOut.add(player);
      const first = finishOrder.indexOf(player) === 0;
      announce(first ? 'winner' : 'out', first ? 'FIRST OUT! WE HAVE A WINNER!' : 'ANOTHER PLAYER ESCAPES!',
        publicName(player) + (first ? ' wins the round. Take a bow!' : ' is out. The pressure is on!'), first ? '🏆' : '👏');
    }
    if (state.phase === 'gameover' && previousPhase === 'play') {
      announce('round', 'ROUND OVER!', state.shitHead
        ? publicName(state.shitHead) + ' is the Shit Head this time. Rematch?'
        : 'All cards played. What a round!', '🎉');
    }
    previousPhase = state.phase;
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
