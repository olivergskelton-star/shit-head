// Gestures forward to the same controls as taps, including online validation.
(() => {
  let gesture = null;
  let suppressClickUntil = 0;
  const handledPointers = new Set();
  const ownTurn = () => state.phase === 'play' && state.currentPlayer === state.viewer
    && !document.querySelector('dialog[open]') && !window.ShitHeadTablePlay?.isOut(state.viewer);
  const usable = button => button && !button.disabled && !button.hidden && button.getClientRects().length > 0;

  document.addEventListener('pointerdown', event => {
    suppressClickUntil = 0;
    if (gesture && event.pointerId !== gesture.id) { gesture = null; return; }
    if (event.pointerType === 'mouse' || !event.isPrimary || !ownTurn()) return;
    const card = event.target.closest('#playerSeat .hand button.card, #playerSeat .self-face-row button.card');
    const pile = event.target.closest('#discardPile');
    if ((!card && !pile) || card?.disabled) return;
    const anchor = card || pile;
    gesture = { id: event.pointerId, anchor, card: !!card, x: event.clientX, y: event.clientY, started: performance.now(), player: state.currentPlayer };
    anchor.setPointerCapture?.(event.pointerId);
  });
  document.addEventListener('pointercancel', () => { gesture = null; });
  document.addEventListener('pointerup', event => {
    const g = gesture;
    if (!g || event.pointerId !== g.id) return;
    gesture = null;
    const dx = event.clientX - g.x, dy = event.clientY - g.y;
    const tapped = Math.max(Math.abs(dx), Math.abs(dy)) < 12;
    if (tapped && !g.card) return;
    handledPointers.add(g.id);
    if (handledPointers.size > 16) handledPointers.delete(handledPointers.values().next().value);
    suppressClickUntil = performance.now() + 500;
    // Dispatch card taps immediately, then consume their delayed native click.
    // This also keeps quick matching-card selections reliable after a flick.
    if (tapped) {
      event.preventDefault();
      if (g.anchor.isConnected && ownTurn() && state.currentPlayer === g.player) g.anchor.click();
      return;
    }
    if (!g.anchor.isConnected || !ownTurn() || state.currentPlayer !== g.player
      || performance.now() - g.started > 1200 || Math.abs(dy) < 45 || Math.abs(dy) < Math.abs(dx) * 1.4) return;
    event.preventDefault();
    if (g.card && dy < 0) {
      if (g.anchor.classList.contains('exposed-blind')) {
        if (usable(g.anchor)) g.anchor.click();
        return;
      }
      // Flick a selected group, or flick one unselected card when no group exists.
      if (!g.anchor.classList.contains('selected')) {
        if (playerSeat.querySelector('button.card.selected')) return;
        g.anchor.click();
      }
      const play = playerSeat.querySelector('.play-selected');
      if (usable(play)) play.click();
    } else if (!g.card && dy > 0) {
      const pickup = playerSeat.querySelector('.pickup-pile');
      if (usable(pickup)) pickup.click();
    }
  }, { passive: false });
  document.addEventListener('click', event => {
    // Avoid a compatibility click selecting the next card after a completed flick.
    if (event.isTrusted && (handledPointers.has(event.pointerId) || (!event.pointerId && performance.now() < suppressClickUntil))
      && event.target.closest('#playerSeat, #discardPile')) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  }, true);
  const syncGestureState = () => document.body.classList.toggle('gesture-turn', ownTurn());
  document.addEventListener('close', syncGestureState, true);
  const previousRender = render;
  render = function renderWithGestures() {
    previousRender();
    syncGestureState();
    const hint = document.createElement('p');
    hint.className = 'gesture-hint';
    hint.textContent = 'Flick cards up to play · swipe the pile down to pick up';
    playerSeat.append(hint);
  };
  render();
})();
