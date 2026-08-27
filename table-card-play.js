// Core end-game table-card play.
// After the draw pile is empty, a player must finish their hand, then their
// face-up table cards, then turn face-down cards blind.
(() => {
  state.selectedZone = null;

  function currentZone(name) {
    const player = state.players?.[name];
    if (!player) return 'out';
    if (player.hand.length > 0 || state.drawPile.length > 0) return 'hand';
    if (player.faceUp.length > 0) return 'faceUp';
    if (player.faceDown.length > 0) return 'faceDown';
    return 'out';
  }

  function sourceFor(name, zone) {
    const player = state.players?.[name];
    if (!player) return [];
    if (zone === 'hand') return player.hand;
    if (zone === 'faceUp') return player.faceUp;
    if (zone === 'faceDown') return player.faceDown;
    return [];
  }

  const nextPlayerBeforeTableCards = nextPlayer;
  nextPlayer = function nextPlayerWithZoneReset() {
    state.selectedZone = null;
    nextPlayerBeforeTableCards();
  };

  const playSelectedHand = playSelected;

  toggleCardSelection = function togglePlayableCardSelection(name, index, zone = 'hand') {
    if (name !== state.currentPlayer) {
      state.lastMessage = `It’s ${publicName(state.currentPlayer)}’s turn.`;
      render();
      return;
    }

    const requiredZone = currentZone(name);
    if (zone !== requiredZone || (zone !== 'hand' && zone !== 'faceUp')) {
      state.lastMessage = requiredZone === 'faceDown'
        ? 'Your face-up cards are gone — choose a face-down card blind.'
        : 'Finish the cards in your hand first.';
      render();
      return;
    }

    const source = sourceFor(name, zone);
    const card = source[index];
    if (!card) return;

    if (state.followUpRank && card.rank !== state.followUpRank) {
      state.lastMessage = `Only another ${state.followUpRank} can be added before the turn passes.`;
      render();
      return;
    }

    if (state.selectedZone !== zone) {
      state.selected = [];
      state.selectedZone = zone;
    }

    if (state.selected.includes(index)) {
      state.selected = state.selected.filter((item) => item !== index);
      if (!state.selected.length) state.selectedZone = null;
      state.lastMessage = '';
      render();
      return;
    }

    if (state.selected.length) {
      const first = source[state.selected[0]];
      if (first && first.rank !== card.rank) {
        state.selected = [index];
        state.selectedZone = zone;
        state.lastMessage = 'Only matching cards can be played together.';
        render();
        return;
      }
    }

    state.selected.push(index);
    state.selected.sort((a, b) => a - b);
    state.selectedZone = zone;
    state.lastMessage = '';
    render();
  };

  function playFaceUpSelected(name) {
    if (name !== state.currentPlayer) {
      state.lastMessage = `It’s ${publicName(state.currentPlayer)}’s turn.`;
      render();
      return;
    }
    if (currentZone(name) !== 'faceUp') {
      state.lastMessage = 'Finish the cards in your hand first.';
      render();
      return;
    }

    const player = state.players[name];
    const source = player.faceUp;
    const indices = [...state.selected].sort((a, b) => a - b);
    if (!indices.length) return;
    const cards = indices.map((index) => source[index]).filter(Boolean);
    if (!cards.length) return;

    const rank = cards[0].rank;
    if (!cards.every((card) => card.rank === rank)) {
      state.lastMessage = 'Only matching ranks can be played together.';
      render();
      return;
    }
    if (state.followUpRank && rank !== state.followUpRank) {
      state.lastMessage = `Only another ${state.followUpRank} can be added before the turn passes.`;
      render();
      return;
    }
    if (!canPlayRank(rank)) {
      const target = typeof effectiveTopDiscard === 'function' ? effectiveTopDiscard() : topDiscard();
      state.lastMessage = target
        ? `${cards.map(cardText).join(', ')} can’t go on ${cardText(target)}${topDiscard()?.rank === '3' ? ' through the transparent 3' : ''}.`
        : 'That play isn’t legal.';
      render();
      return;
    }

    for (const index of [...indices].sort((a, b) => b - a)) source.splice(index, 1);
    cards.forEach((card) => state.discard.push(card));

    const cleared = shouldClearPile(rank);
    const n = publicName(name);
    state.selected = [];
    state.selectedZone = null;

    if (cleared) {
      const burnedCount = state.discard.length;
      if (typeof burnDiscardPile === 'function') burnDiscardPile();
      else state.discard = [];
      state.followUpRank = null;
      state.lastMessage = rank === '10'
        ? `${n} burned ${burnedCount} cards with a 10 — go again.`
        : rank === '8'
          ? `${n} burned the pile with three 8s — go again.`
          : `${n} burned the pile with four ${rank}s — go again.`;
      render();
      return;
    }

    if (source.some((card) => card.rank === rank)) {
      state.followUpRank = rank;
      state.lastMessage = `${n} played ${cards.length > 1 ? cards.length + ' × ' + rank : cardText(cards[0])}. Another ${rank} is available — add it or finish turn.`;
      render();
      return;
    }

    state.followUpRank = null;
    if (rank === '2') state.lastMessage = `${n} reset the pile with a 2.`;
    else if (rank === '7') state.lastMessage = `${n} played a 7 — ${publicName(PLAYER_NAMES[(PLAYER_NAMES.indexOf(name) + 1) % PLAYER_NAMES.length])} must play 7 or lower.`;
    else if (rank === '3') {
      const target = typeof effectiveTopDiscard === 'function' ? effectiveTopDiscard() : null;
      state.lastMessage = target ? `${n} played a transparent 3 — ${cardText(target)} is still the live card.` : `${n} played a transparent 3.`;
    } else state.lastMessage = `${n} played ${cards.length > 1 ? cards.length + ' × ' + rank : cardText(cards[0])}.`;

    nextPlayer();
    render();
  }

  playSelected = function playSelectedFromCurrentZone(name) {
    const zone = state.selectedZone || currentZone(name);
    if (zone === 'faceUp') {
      playFaceUpSelected(name);
      return;
    }
    if (zone === 'faceDown') {
      state.lastMessage = 'Choose one face-down card blind.';
      render();
      return;
    }
    playSelectedHand(name);
    if (!state.selected.length) state.selectedZone = null;
  };

  function playFaceDownCard(name, index) {
    if (name !== state.currentPlayer) {
      state.lastMessage = `It’s ${publicName(state.currentPlayer)}’s turn.`;
      render();
      return false;
    }
    if (currentZone(name) !== 'faceDown') {
      state.lastMessage = 'Finish your hand and face-up cards first.';
      render();
      return false;
    }

    const player = state.players[name];
    const card = player.faceDown[index];
    if (!card) return false;

    const targetBefore = typeof effectiveTopDiscard === 'function' ? effectiveTopDiscard() : topDiscard();
    player.faceDown.splice(index, 1);
    state.selected = [];
    state.selectedZone = null;
    state.followUpRank = null;

    if (!canPlayRank(card.rank)) {
      const pickedUp = state.discard.length + 1;
      player.hand.push(...state.discard, card);
      state.discard = [];
      state.lastMessage = targetBefore
        ? `${publicName(name)} turned over ${cardText(card)} — it can’t go on ${cardText(targetBefore)}, so picked up ${pickedUp} card${pickedUp === 1 ? '' : 's'}.`
        : `${publicName(name)} turned over ${cardText(card)} and picked it up.`;
      nextPlayer();
      render();
      return true;
    }

    state.discard.push(card);
    const rank = card.rank;
    const cleared = shouldClearPile(rank);
    const n = publicName(name);

    if (cleared) {
      const burnedCount = state.discard.length;
      if (typeof burnDiscardPile === 'function') burnDiscardPile();
      else state.discard = [];
      state.lastMessage = rank === '10'
        ? `${n} turned over ${cardText(card)} and burned ${burnedCount} cards — go again.`
        : rank === '8'
          ? `${n} turned over ${cardText(card)} and completed three 8s — pile burned, go again.`
          : `${n} turned over ${cardText(card)} and completed four ${rank}s — pile burned, go again.`;
      render();
      return true;
    }

    if (rank === '2') state.lastMessage = `${n} turned over ${cardText(card)} and reset the pile.`;
    else if (rank === '7') state.lastMessage = `${n} turned over a 7 — ${publicName(PLAYER_NAMES[(PLAYER_NAMES.indexOf(name) + 1) % PLAYER_NAMES.length])} must play 7 or lower.`;
    else if (rank === '3') {
      const target = typeof effectiveTopDiscard === 'function' ? effectiveTopDiscard() : null;
      state.lastMessage = target ? `${n} turned over a transparent 3 — ${cardText(target)} is still live.` : `${n} turned over a transparent 3.`;
    } else state.lastMessage = `${n} turned over and played ${cardText(card)}.`;

    nextPlayer();
    render();
    return true;
  }

  function decorateSelfTable() {
    if (state.phase !== 'play') return;
    const name = state.viewer;
    const player = state.players?.[name];
    if (!player) return;
    const zone = currentZone(name);
    const row = playerSeat.querySelector('.self-face-row');
    const label = playerSeat.querySelector('.self-table-zone .player-label');
    if (!row) return;

    if (zone === 'faceUp') {
      if (label) label.textContent = 'Your face-up cards';
      const stacks = [...row.querySelectorAll('.face-stack')];
      stacks.forEach((stack, index) => {
        const existing = stack.querySelector('.card:not(.card-back)');
        const card = player.faceUp[index];
        if (!existing || !card) return;
        const button = makeCard(card, {
          button: true,
          selected: state.selectedZone === 'faceUp' && state.selected.includes(index),
          onClick: () => toggleCardSelection(name, index, 'faceUp'),
        });
        button.classList.add('table-play-card');
        button.dataset.playZone = 'faceUp';
        button.dataset.playIndex = String(index);
        existing.replaceWith(button);
      });
      return;
    }

    if (zone === 'faceDown') {
      if (label) label.textContent = 'Your face-down cards — choose one blind';
      row.replaceChildren();
      player.faceDown.forEach((_, index) => {
        const stack = document.createElement('div');
        stack.className = 'face-stack';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'card card-back table-blind-card';
        button.dataset.playZone = 'faceDown';
        button.dataset.playIndex = String(index);
        button.setAttribute('aria-label', `Face-down card ${index + 1}, play blind`);
        button.addEventListener('click', () => playFaceDownCard(name, index));
        stack.append(button);
        row.append(stack);
      });
      return;
    }

    if (zone === 'out' && label) label.textContent = 'No table cards left';
  }

  function decorateOpponentBacks(container, name) {
    const player = state.players?.[name];
    if (!player || player.faceUp.length || !player.faceDown.length) return;
    const row = container.querySelector('.face-row');
    if (!row || row.children.length) return;
    player.faceDown.forEach(() => {
      const stack = document.createElement('div');
      stack.className = 'face-stack';
      stack.append(makeBack());
      row.append(stack);
    });
  }

  function decoratePlayableZones() {
    if (state.phase !== 'play') return;
    decorateSelfTable();
    const seats = seatingForViewer();
    decorateOpponentBacks(opponentLeft, seats.left);
    decorateOpponentBacks(opponentRight, seats.right);
  }

  const renderBeforeTableCardPlay = render;
  render = function renderWithTableCardPlay() {
    renderBeforeTableCardPlay();
    decoratePlayableZones();
  };

  window.ShitHeadTablePlay = {
    currentZone,
    playFaceDown: playFaceDownCard,
    sourceLength(name, zone) { return sourceFor(name, zone).length; },
  };

  render();
})();
