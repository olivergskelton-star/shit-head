// 0.9.15 table/end-game engine.
// The table is three permanent physical slots. Each slot independently keeps a
// face-up card and the face-down card underneath it. Once the draw pile is gone:
// - finish the hand;
// - the final hand play may include matching face-up table cards;
// - with no hand, any visible face-up card OR any exposed face-down card may be used;
// - players with no cards anywhere are OUT and are skipped.
(() => {
  function ensurePrivateSelection() {
    if (!Object.prototype.hasOwnProperty.call(state, 'selectedRefs')) {
      Object.defineProperty(state, 'selectedRefs', {
        value: [],
        writable: true,
        configurable: true,
        enumerable: false,
      });
    }
  }

  ensurePrivateSelection();
  state.finishOrder = Array.isArray(state.finishOrder) ? state.finishOrder : [];
  state.shitHead = state.shitHead || null;

  function ensureTableSlots(name) {
    const player = state.players?.[name];
    if (!player) return [];

    if (!Array.isArray(player.tableSlots) || player.tableSlots.length !== 3) {
      const faceUp = [...(player.faceUp || [])];
      const faceDown = [...(player.faceDown || [])];
      player.tableSlots = [0, 1, 2].map((index) => ({
        faceUp: faceUp[index] || null,
        faceDown: faceDown[index] || null,
      }));
    } else {
      player.tableSlots = player.tableSlots.map((slot) => ({
        faceUp: slot?.faceUp || null,
        faceDown: slot?.faceDown || null,
      }));
    }

    return player.tableSlots;
  }

  function ensureAllTableSlots() {
    if (state.phase !== 'play' && state.phase !== 'gameover') return;
    PLAYER_NAMES.forEach(ensureTableSlots);
  }

  function syncLegacyArrays(name) {
    const player = state.players?.[name];
    if (!player) return;
    const slots = ensureTableSlots(name);
    // Legacy renderers still expect these arrays. They are compact mirrors only;
    // tableSlots is the canonical positional state once play has begun.
    player.faceUp = slots.map((slot) => slot.faceUp).filter(Boolean);
    player.faceDown = slots.map((slot) => slot.faceDown).filter(Boolean);
  }

  function tableCardsRemaining(name) {
    return ensureTableSlots(name).some((slot) => slot.faceUp || slot.faceDown);
  }

  function isPlayerOut(name) {
    const player = state.players?.[name];
    if (!player) return true;
    return player.hand.length === 0 && !tableCardsRemaining(name);
  }

  function livingPlayers() {
    ensureAllTableSlots();
    return PLAYER_NAMES.filter((name) => !isPlayerOut(name));
  }

  function markOut(name) {
    if (!isPlayerOut(name)) return false;
    if (!state.finishOrder.includes(name)) state.finishOrder.push(name);
    return true;
  }

  function clearSelection() {
    ensurePrivateSelection();
    state.selectedRefs = [];
    state.selected = [];
    state.selectedZone = null;
  }

  function concludeIfNeeded(lastOut = null) {
    const living = livingPlayers();
    if (living.length > 1) return false;

    state.followUpRank = null;
    clearSelection();
    state.phase = 'gameover';
    state.shitHead = living[0] || null;
    state.currentPlayer = state.shitHead;

    if (state.shitHead) {
      const outPrefix = lastOut ? `${publicName(lastOut)} is OUT. ` : '';
      state.lastMessage = `${outPrefix}${publicName(state.shitHead)} is the Shit Head. Game over.`;
    } else {
      state.lastMessage = 'Game over.';
    }
    return true;
  }

  function advanceTurn(fromName, lastOut = null) {
    if (concludeIfNeeded(lastOut)) return null;

    const fromIndex = Math.max(0, PLAYER_NAMES.indexOf(fromName));
    for (let offset = 1; offset <= PLAYER_NAMES.length; offset += 1) {
      const candidate = PLAYER_NAMES[(fromIndex + offset) % PLAYER_NAMES.length];
      if (!isPlayerOut(candidate)) {
        state.currentPlayer = candidate;
        clearSelection();
        return candidate;
      }
    }
    return null;
  }

  // Replace the old round-robin function globally so every older engine path also
  // skips players who are already out.
  nextPlayer = function nextLivingPlayer() {
    return advanceTurn(state.currentPlayer);
  };

  function currentZone(name) {
    const player = state.players?.[name];
    if (!player || isPlayerOut(name)) return 'out';
    if (player.hand.length > 0 || state.drawPile.length > 0) return 'hand';
    return 'table';
  }

  function cardForRef(name, ref) {
    const player = state.players?.[name];
    if (!player || !ref) return null;
    if (ref.zone === 'hand') return player.hand[ref.index] || null;
    if (ref.zone === 'faceUp') return ensureTableSlots(name)[ref.index]?.faceUp || null;
    return null;
  }

  function refKey(ref) {
    return `${ref.zone}:${ref.index}`;
  }

  function normaliseRefs(name, refs) {
    const seen = new Set();
    return (Array.isArray(refs) ? refs : [])
      .filter((ref) => ref && (ref.zone === 'hand' || ref.zone === 'faceUp') && Number.isInteger(ref.index))
      .filter((ref) => {
        const key = refKey(ref);
        if (seen.has(key) || !cardForRef(name, ref)) return false;
        seen.add(key);
        return true;
      });
  }

  function selectedRank(name, refs) {
    const first = normaliseRefs(name, refs)[0];
    return first ? cardForRef(name, first)?.rank || null : null;
  }

  function allHandCardsSelected(name, refs) {
    const hand = state.players?.[name]?.hand || [];
    const selected = new Set(normaliseRefs(name, refs)
      .filter((ref) => ref.zone === 'hand')
      .map((ref) => ref.index));
    return hand.length > 0 && selected.size === hand.length && hand.every((_, index) => selected.has(index));
  }

  function validatePlayRefs(name, refs) {
    if (state.phase !== 'play') return { ok: false, message: 'The game is not in play.' };
    if (name !== state.currentPlayer) return { ok: false, message: `It’s ${publicName(state.currentPlayer)}’s turn.` };

    const player = state.players?.[name];
    if (!player) return { ok: false, message: 'Player not found.' };

    const clean = normaliseRefs(name, refs);
    if (!clean.length) return { ok: false, message: 'Choose a card first.' };

    const cards = clean.map((ref) => cardForRef(name, ref));
    const rank = cards[0]?.rank;
    if (!rank || !cards.every((card) => card?.rank === rank)) {
      return { ok: false, message: 'Only matching ranks can be played together.' };
    }

    if (state.followUpRank && rank !== state.followUpRank) {
      return { ok: false, message: `Only another ${state.followUpRank} can be added before the turn passes.` };
    }

    const handRefs = clean.filter((ref) => ref.zone === 'hand');
    const faceRefs = clean.filter((ref) => ref.zone === 'faceUp');

    if (player.hand.length > 0 || state.drawPile.length > 0) {
      if (!handRefs.length) return { ok: false, message: 'Finish the cards in your hand first.' };

      if (faceRefs.length) {
        if (state.drawPile.length > 0) {
          return { ok: false, message: 'Table cards cannot be added while the draw pile is still in play.' };
        }
        if (!allHandCardsSelected(name, clean)) {
          return { ok: false, message: `Select every remaining ${rank} in your hand before adding a matching table card.` };
        }
      }
    } else if (handRefs.length) {
      return { ok: false, message: 'Your hand is already finished.' };
    }

    if (!canPlayRank(rank)) {
      const target = typeof effectiveTopDiscard === 'function' ? effectiveTopDiscard() : topDiscard();
      return {
        ok: false,
        message: target
          ? `${cards.map(cardText).join(', ')} can’t go on ${cardText(target)}${topDiscard()?.rank === '3' ? ' through the transparent 3' : ''}.`
          : 'That play isn’t legal.',
      };
    }

    return { ok: true, refs: clean, cards, rank };
  }

  function toggleRefs(name, refs, ref) {
    const player = state.players?.[name];
    if (!player || !cardForRef(name, ref)) return { refs: normaliseRefs(name, refs), message: '' };

    let next = normaliseRefs(name, refs);
    const key = refKey(ref);
    const existing = next.findIndex((item) => refKey(item) === key);
    if (existing >= 0) {
      next.splice(existing, 1);
      // A face-up card is only legal alongside a hand selection if every hand card
      // is still selected. Drop table additions if the player deselects a hand card.
      if (player.hand.length > 0 && next.some((item) => item.zone === 'faceUp') && !allHandCardsSelected(name, next)) {
        next = next.filter((item) => item.zone === 'hand');
      }
      return { refs: next, message: '' };
    }

    const card = cardForRef(name, ref);
    const rank = selectedRank(name, next);
    if (rank && card.rank !== rank) {
      if (ref.zone === 'faceUp' && player.hand.length > 0) {
        return { refs: next, message: 'Finish the matching cards in your hand first.' };
      }
      next = [ref];
    } else {
      next.push(ref);
    }

    if (ref.zone === 'faceUp' && player.hand.length > 0) {
      if (state.drawPile.length > 0) {
        return { refs: normaliseRefs(name, refs), message: 'Table cards cannot be added while the draw pile is still in play.' };
      }
      if (!allHandCardsSelected(name, next)) {
        return {
          refs: normaliseRefs(name, refs),
          message: `Select all ${card.rank}s remaining in your hand first, then add the matching table card.`,
        };
      }
    }

    return { refs: normaliseRefs(name, next), message: '' };
  }

  function hasKnownFollowUp(name, rank) {
    const player = state.players?.[name];
    if (!player || isPlayerOut(name)) return false;
    if (player.hand.some((card) => card.rank === rank)) return true;
    if (state.drawPile.length === 0 && player.hand.length === 0) {
      return ensureTableSlots(name).some((slot) => slot.faceUp?.rank === rank);
    }
    return false;
  }

  function publicPlayMessage(name, rank, cards) {
    const n = publicName(name);
    if (rank === '2') return `${n} reset the pile with a 2.`;
    if (rank === '7') return `${n} played a 7 — the next player must play 7 or lower.`;
    if (rank === '3') {
      const target = typeof effectiveTopDiscard === 'function' ? effectiveTopDiscard() : null;
      return target ? `${n} played a transparent 3 — ${cardText(target)} is still the live card.` : `${n} played a transparent 3.`;
    }
    return `${n} played ${cards.length > 1 ? `${cards.length} × ${rank}` : cardText(cards[0])}.`;
  }

  function applyPlayedCards(name, refs) {
    const player = state.players[name];
    const slots = ensureTableSlots(name);
    const handIndices = refs.filter((ref) => ref.zone === 'hand').map((ref) => ref.index).sort((a, b) => b - a);
    const faceSlots = refs.filter((ref) => ref.zone === 'faceUp').map((ref) => ref.index);

    handIndices.forEach((index) => player.hand.splice(index, 1));
    faceSlots.forEach((slotIndex) => {
      if (slots[slotIndex]) slots[slotIndex].faceUp = null;
    });
    syncLegacyArrays(name);
  }

  function playRefs(name, refs) {
    ensureAllTableSlots();
    const check = validatePlayRefs(name, refs);
    if (!check.ok) {
      state.lastMessage = check.message;
      render();
      return false;
    }

    const { cards, rank } = check;
    applyPlayedCards(name, check.refs);
    cards.forEach((card) => state.discard.push(card));

    // Standard hand refill still applies until the draw pile is exhausted. A mixed
    // hand+table play is only permitted with an empty draw pile, so this cannot
    // accidentally refill after touching a table card.
    refillHand(state.players[name]);
    clearSelection();

    const cleared = shouldClearPile(rank);
    const n = publicName(name);
    const becameOut = markOut(name);

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

      if (becameOut) {
        state.lastMessage = `${state.lastMessage.replace(' — go again.', '.')} ${n} is OUT.`;
        advanceTurn(name, name);
      }
      render();
      return true;
    }

    state.lastMessage = publicPlayMessage(name, rank, cards);
    if (becameOut) state.lastMessage = `${state.lastMessage} ${n} is OUT.`;

    if (!becameOut && hasKnownFollowUp(name, rank)) {
      // Deliberately do NOT publish the hidden-hand fact. The active player gets
      // FINISH TURN and can see their own matching cards; everyone else only sees
      // the public play that just occurred.
      state.followUpRank = rank;
    } else {
      state.followUpRank = null;
      advanceTurn(name, becameOut ? name : null);
    }

    render();
    return true;
  }

  function canPlayBlind(name, slotIndex) {
    const player = state.players?.[name];
    const slot = ensureTableSlots(name)[slotIndex];
    return !!player
      && state.phase === 'play'
      && state.currentPlayer === name
      && state.drawPile.length === 0
      && player.hand.length === 0
      && !state.followUpRank
      && !!slot?.faceDown
      && !slot.faceUp;
  }

  function playFaceDownCard(name, slotIndex) {
    ensureAllTableSlots();
    if (!canPlayBlind(name, slotIndex)) {
      state.lastMessage = state.followUpRank
        ? `Finish the current ${state.followUpRank}s before choosing a blind card.`
        : 'You can only play a face-down card once it is exposed and your hand is empty.';
      render();
      return false;
    }

    const player = state.players[name];
    const slots = ensureTableSlots(name);
    const card = slots[slotIndex].faceDown;
    const targetBefore = typeof effectiveTopDiscard === 'function' ? effectiveTopDiscard() : topDiscard();
    slots[slotIndex].faceDown = null;
    syncLegacyArrays(name);
    clearSelection();
    state.followUpRank = null;

    if (!canPlayRank(card.rank)) {
      const pickedUp = state.discard.length + 1;
      player.hand.push(...state.discard, card);
      state.discard = [];
      state.lastMessage = targetBefore
        ? `${publicName(name)} turned over ${cardText(card)} — it can’t go on ${cardText(targetBefore)}, so picked up ${pickedUp} card${pickedUp === 1 ? '' : 's'}.`
        : `${publicName(name)} turned over ${cardText(card)} and picked it up.`;
      advanceTurn(name);
      render();
      return true;
    }

    state.discard.push(card);
    const rank = card.rank;
    const cleared = shouldClearPile(rank);
    const n = publicName(name);
    const becameOut = markOut(name);

    if (cleared) {
      const burnedCount = state.discard.length;
      if (typeof burnDiscardPile === 'function') burnDiscardPile();
      else state.discard = [];
      state.lastMessage = rank === '10'
        ? `${n} turned over ${cardText(card)} and burned ${burnedCount} cards — go again.`
        : rank === '8'
          ? `${n} turned over ${cardText(card)} and completed three 8s — pile burned, go again.`
          : `${n} turned over ${cardText(card)} and completed four ${rank}s — pile burned, go again.`;

      if (becameOut) {
        state.lastMessage = `${state.lastMessage.replace(' — go again.', '.')} ${n} is OUT.`;
        advanceTurn(name, name);
      }
      render();
      return true;
    }

    if (rank === '2') state.lastMessage = `${n} turned over ${cardText(card)} and reset the pile.`;
    else if (rank === '7') state.lastMessage = `${n} turned over a 7 — the next player must play 7 or lower.`;
    else if (rank === '3') {
      const target = typeof effectiveTopDiscard === 'function' ? effectiveTopDiscard() : null;
      state.lastMessage = target ? `${n} turned over a transparent 3 — ${cardText(target)} is still live.` : `${n} turned over a transparent 3.`;
    } else state.lastMessage = `${n} turned over and played ${cardText(card)}.`;

    if (becameOut) state.lastMessage = `${state.lastMessage} ${n} is OUT.`;

    if (!becameOut && hasKnownFollowUp(name, rank)) {
      state.followUpRank = rank;
    } else {
      state.followUpRank = null;
      advanceTurn(name, becameOut ? name : null);
    }

    render();
    return true;
  }

  // Replace the old engine actions so pickup/finish also respect out-player skipping.
  pickupDiscard = function pickupDiscard0915(name) {
    if (name !== state.currentPlayer || state.phase !== 'play') {
      state.lastMessage = state.currentPlayer ? `It’s ${publicName(state.currentPlayer)}’s turn.` : 'The game is over.';
      render();
      return;
    }
    if (state.followUpRank) {
      state.lastMessage = `You’ve already played — add another ${state.followUpRank} or finish the turn.`;
      render();
      return;
    }
    if (!state.discard.length) {
      state.lastMessage = 'There’s no pile to pick up.';
      render();
      return;
    }

    const count = state.discard.length;
    state.players[name].hand.push(...state.discard);
    state.discard = [];
    clearSelection();
    state.lastMessage = `${publicName(name)} picked up ${count} card${count === 1 ? '' : 's'}.`;
    advanceTurn(name);
    render();
  };

  finishTurn = function finishTurn0915(name) {
    if (name !== state.currentPlayer || state.phase !== 'play' || !state.followUpRank) return;
    const rank = state.followUpRank;
    state.followUpRank = null;
    clearSelection();
    state.lastMessage = `${publicName(name)} finished the ${rank}s.`;
    advanceTurn(name);
    render();
  };

  // Local/single-browser selection. Online browsers use the multiplayer selection
  // layer, which calls the same toggleRefs/playRefs functions with private refs.
  toggleCardSelection = function toggleCardSelection0915(name, index, zone = 'hand') {
    if (state.phase !== 'play' || name !== state.currentPlayer) {
      state.lastMessage = state.currentPlayer ? `It’s ${publicName(state.currentPlayer)}’s turn.` : 'The game is over.';
      render();
      return;
    }

    const ref = { zone: zone === 'faceUp' ? 'faceUp' : 'hand', index };
    const result = toggleRefs(name, state.selectedRefs, ref);
    state.selectedRefs = result.refs;
    state.selected = result.refs.filter((item) => item.zone === 'hand').map((item) => item.index);
    state.selectedZone = result.refs.some((item) => item.zone === 'faceUp')
      ? (result.refs.some((item) => item.zone === 'hand') ? 'mixed' : 'faceUp')
      : 'hand';
    state.lastMessage = result.message || '';
    render();
  };

  playSelected = function playSelected0915(name) {
    return playRefs(name, state.selectedRefs);
  };

  function canPotentiallyClickFaceUp(name, slot) {
    const player = state.players?.[name];
    if (!player || !slot?.faceUp || state.phase !== 'play' || state.currentPlayer !== name || state.drawPile.length > 0) return false;
    if (player.hand.length === 0) return true;
    return player.hand.every((card) => card.rank === slot.faceUp.rank);
  }

  function makeBlindButton(name, slotIndex) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'card card-back table-blind-card exposed-blind';
    button.dataset.playZone = 'faceDown';
    button.dataset.slotIndex = String(slotIndex);
    button.setAttribute('aria-label', `Face-down card ${slotIndex + 1}, play blind`);
    button.addEventListener('click', () => playFaceDownCard(name, slotIndex));
    return button;
  }

  function renderTableRow(row, name, isSelf) {
    if (!row) return;
    const player = state.players?.[name];
    if (!player) return;
    const slots = ensureTableSlots(name);
    row.replaceChildren();

    slots.forEach((slot, slotIndex) => {
      const stack = document.createElement('div');
      stack.className = 'face-stack table-slot';
      stack.dataset.slotIndex = String(slotIndex);

      if (slot.faceDown) {
        if (isSelf && canPlayBlind(name, slotIndex)) stack.append(makeBlindButton(name, slotIndex));
        else stack.append(makeBack());
      }

      if (slot.faceUp) {
        const clickable = isSelf && canPotentiallyClickFaceUp(name, slot);
        const top = makeCard(slot.faceUp, clickable ? {
          button: true,
          selected: state.selectedRefs.some((ref) => ref.zone === 'faceUp' && ref.index === slotIndex),
          onClick: () => toggleCardSelection(name, slotIndex, 'faceUp'),
        } : {});
        top.classList.add('table-play-card');
        top.dataset.playZone = 'faceUp';
        top.dataset.slotIndex = String(slotIndex);
        stack.append(top);
      }

      if (!slot.faceUp && !slot.faceDown) stack.classList.add('empty-table-slot');
      row.append(stack);
    });
  }

  function decorateSelfTable() {
    if (state.phase !== 'play' && state.phase !== 'gameover') return;
    const name = state.viewer;
    const player = state.players?.[name];
    if (!player) return;

    renderTableRow(playerSeat.querySelector('.self-face-row'), name, true);

    const label = playerSeat.querySelector('.self-table-zone .player-label');
    if (label) {
      if (isPlayerOut(name)) label.textContent = 'You are OUT';
      else if (player.hand.length === 0 && state.drawPile.length === 0) label.textContent = 'Your table — play a face-up card or an exposed blind card';
      else label.textContent = 'Your table cards';
    }

    const identity = playerSeat.querySelector('.self-identity-row');
    if (identity) {
      let badge = identity.querySelector('.self-hand-count');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'self-hand-count';
        identity.append(badge);
      }
      badge.textContent = isPlayerOut(name) ? 'OUT' : `HAND ×${player.hand.length}`;
      badge.setAttribute('aria-label', isPlayerOut(name) ? 'You are out' : `${player.hand.length} cards in your hand`);
    }
  }

  function decorateOpponentTable(container, name) {
    if (state.phase !== 'play' && state.phase !== 'gameover') return;
    const row = container?.querySelector('.face-row');
    if (row) renderTableRow(row, name, false);
    container?.classList.toggle('player-out', isPlayerOut(name));
  }

  function decorateTables() {
    if (state.phase !== 'play' && state.phase !== 'gameover') return;
    ensureAllTableSlots();
    decorateSelfTable();
    const seats = seatingForViewer();
    decorateOpponentTable(opponentLeft, seats.left);
    decorateOpponentTable(opponentRight, seats.right);

    if (state.phase === 'gameover') {
      statusText.hidden = false;
      statusText.textContent = state.lastMessage;
    }
  }

  const renderBeforeTableCardPlay = render;
  render = function renderWithTableCardPlay0915() {
    renderBeforeTableCardPlay();
    decorateTables();
  };

  window.ShitHeadTablePlay = {
    ensureTableSlots,
    getSlots: ensureTableSlots,
    currentZone,
    isOut: isPlayerOut,
    livingPlayers,
    cardForRef,
    toggleRefs,
    validateRefs: validatePlayRefs,
    playRefs,
    playFaceDown: playFaceDownCard,
    canBlind: canPlayBlind,
    sourceLength(name, zone) {
      if (zone === 'hand') return state.players?.[name]?.hand?.length || 0;
      if (zone === 'faceUp' || zone === 'faceDown') return ensureTableSlots(name).length;
      return 0;
    },
  };

  newGameBtn.addEventListener('click', () => {
    state.finishOrder = [];
    state.shitHead = null;
    clearSelection();
    PLAYER_NAMES.forEach((name) => {
      if (state.players?.[name]) delete state.players[name].tableSlots;
    });
  });

  render();
})();