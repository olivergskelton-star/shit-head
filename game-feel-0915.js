// 0.9.15 visual feedback: messy public pile, run indicator and short card movement.
(() => {
  const pileOffsets = [
    { x: -6, y: 4, r: -5 },
    { x: 5, y: 1, r: 4 },
    { x: -2, y: -2, r: -2 },
    { x: 2, y: -4, r: 1 },
  ];

  function rawTopRun() {
    const top = state.discard[state.discard.length - 1];
    if (!top) return { rank: null, count: 0 };
    let count = 0;
    for (let index = state.discard.length - 1; index >= 0; index -= 1) {
      if (state.discard[index].rank !== top.rank) break;
      count += 1;
    }
    return { rank: top.rank, count };
  }

  function renderPileFeel() {
    if (!discardPile) return;

    discardPile.replaceChildren();
    discardPile.classList.toggle('is-empty', state.discard.length === 0);
    discardPile.setAttribute('aria-label', `Pile, ${state.discard.length} card${state.discard.length === 1 ? '' : 's'}`);

    const externalCount = document.querySelector('#pileCount');
    if (externalCount) {
      externalCount.textContent = String(state.discard.length);
      externalCount.classList.toggle('is-zero', state.discard.length === 0);
    }

    if (!state.discard.length) return;

    const visible = state.discard.slice(-4);
    visible.forEach((card, index) => {
      const depth = visible.length - 1 - index;
      const offset = pileOffsets[Math.min(depth, pileOffsets.length - 1)];
      const el = makeCard(card);
      el.classList.add('pile-mess-card');
      el.style.setProperty('--pile-x', `${offset.x}px`);
      el.style.setProperty('--pile-y', `${offset.y}px`);
      el.style.setProperty('--pile-r', `${offset.r}deg`);
      el.style.setProperty('--pile-z', String(10 + index));
      discardPile.append(el);
    });

    const run = rawTopRun();
    if (run.count >= 2) {
      const indicator = document.createElement('span');
      indicator.className = 'pile-run-indicator';
      const nextBurn = (run.rank === '8' && run.count === 2) || (run.rank !== '8' && run.count === 3);
      if (nextBurn) indicator.classList.add('next-burn');

      const count = document.createElement('span');
      count.textContent = `${run.count} × ${run.rank}`;
      indicator.append(count);

      if (nextBurn) {
        const note = document.createElement('span');
        note.className = 'run-note';
        note.textContent = `next ${run.rank} burns`;
        indicator.append(note);
      }
      discardPile.append(indicator);
    }
  }

  function capture() {
    return {
      phase: state.phase,
      currentPlayer: state.currentPlayer,
      discardCount: state.discard.length,
      burnCount: state.burnPile?.length || 0,
      hands: Object.fromEntries(PLAYER_NAMES.map((name) => [name, state.players?.[name]?.hand?.length || 0])),
    };
  }

  function seatFor(name) {
    if (name === state.viewer) return playerSeat;
    const seats = seatingForViewer();
    if (seats.left === name) return opponentLeft;
    if (seats.right === name) return opponentRight;
    return playerSeat;
  }

  function reducedMotion() {
    return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  }

  function animateGhost(card, fromEl, toEl, { delay = 0, back = false, duration = 270 } = {}) {
    if (reducedMotion() || !fromEl || !toEl || typeof Element.prototype.animate !== 'function') return;
    const from = fromEl.getBoundingClientRect();
    const to = toEl.getBoundingClientRect();
    if (!from.width || !from.height || !to.width || !to.height) return;

    const ghost = back ? makeBack() : makeCard(card || { rank: '', suit: '' });
    ghost.classList.add('card-flight-ghost');
    const width = window.innerWidth <= 700 ? 52 : 62;
    const height = width / .71;
    const startX = from.left + from.width / 2 - width / 2;
    const startY = from.top + from.height / 2 - height / 2;
    const endX = to.left + to.width / 2 - width / 2;
    const endY = to.top + to.height / 2 - height / 2;

    ghost.style.left = `${startX}px`;
    ghost.style.top = `${startY}px`;
    document.body.append(ghost);

    const dx = endX - startX;
    const dy = endY - startY;
    const animation = ghost.animate([
      { transform: 'translate(0, 0) rotate(-5deg) scale(1)', opacity: .9 },
      { transform: `translate(${dx}px, ${dy}px) rotate(4deg) scale(.96)`, opacity: 1 },
    ], {
      duration,
      delay,
      easing: 'cubic-bezier(.22,.78,.22,1)',
      fill: 'forwards',
    });
    animation.finished.catch(() => {}).finally(() => ghost.remove());
  }

  function animateStateChange(before, after) {
    if (!before || before.phase !== 'play' || (after.phase !== 'play' && after.phase !== 'gameover')) return;

    const actor = before.currentPlayer;
    const actorSeat = seatFor(actor);
    const burn = document.querySelector('#burnPile');
    const burnDelta = after.burnCount - before.burnCount;

    if (burnDelta > 0 && after.discardCount === 0) {
      const lastBurned = state.burnPile?.[state.burnPile.length - 1] || null;
      animateGhost(lastBurned, actorSeat, discardPile, { duration: 210 });
      animateGhost(null, discardPile, burn, { delay: 120, back: true, duration: 260 });
      return;
    }

    if (before.discardCount > 0 && after.discardCount === 0) {
      const gainer = PLAYER_NAMES.find((name) => after.hands[name] > before.hands[name]) || actor;
      animateGhost(null, discardPile, seatFor(gainer), { back: true, duration: 300 });
      return;
    }

    if (after.discardCount > before.discardCount) {
      const added = state.discard.slice(before.discardCount);
      added.forEach((card, index) => {
        animateGhost(card, actorSeat, discardPile, { delay: index * 42, duration: 250 });
      });
    }
  }

  let previous = null;
  const renderBeforeFeel = render;
  render = function renderWith0915Feel() {
    const before = previous;
    renderBeforeFeel();
    renderPileFeel();
    const after = capture();
    animateStateChange(before, after);
    previous = after;
  };

  render();
})();
