// Build 0.9.20: drink-only coasters and paper player status notepads.
(() => {
  const DRINKS = Object.freeze({
    wine: { label: 'Wine', icon: '🍷' },
    beer: { label: 'Beer', icon: '🍺' },
    coffee: { label: 'Coffee', icon: '☕' },
    tea: { label: 'Tea', icon: '🍵' },
    'jd-coke': { label: 'JD & Coke', icon: '🥃' },
    'gin-tonic': { label: 'G&T', icon: '🍸' },
  });
  const DEFAULT_DRINK = Object.freeze({ Oliver: 'wine', Dan: 'beer', Chris: 'gin-tonic' });

  // Calibrated on the 300-game / 35k public-position holdout run.
  const CALIBRATION = Object.freeze({
    burden: Object.freeze({ hand: 3.75, faceUp: 5.25, faceDown: 7.5 }),
    cardQualityWeight: 0.9,
    pickupBase: 3.2,
    pickupLogWeight: 2,
    temperatures: Object.freeze({ draw: 48, tableThree: 36, twoPlayer: 24 }),
  });

  function validDrink(id) { return !!DRINKS[id]; }
  function cardId(card) { return card ? `${card.rank}|${card.suit}` : null; }

  function ensurePlayerDrink(name) {
    const player = state.players?.[name];
    if (!player) return DEFAULT_DRINK[name] || 'wine';
    if (validDrink(player.drink)) return player.drink;
    const saved = localStorage.getItem(`shithead-drink-${name}`);
    player.drink = validDrink(saved) ? saved : (DEFAULT_DRINK[name] || 'wine');
    return player.drink;
  }

  function ensureKnownHand(name) {
    const player = state.players?.[name];
    if (!player) return [];
    if (!Array.isArray(player.knownHand)) player.knownHand = [];
    const live = new Set((player.hand || []).map(cardId));
    player.knownHand = player.knownHand.filter((card) => live.has(cardId(card)));
    return player.knownHand;
  }

  function rememberKnownCards(name, cards) {
    const player = state.players?.[name];
    if (!player) return;
    const known = ensureKnownHand(name);
    const live = new Set((player.hand || []).map(cardId));
    const existing = new Set(known.map(cardId));
    (cards || []).forEach((card) => {
      const id = cardId(card);
      if (!id || !live.has(id) || existing.has(id)) return;
      known.push({ rank: card.rank, suit: card.suit });
      existing.add(id);
    });
  }

  // Preserve public card memory after voluntary pile pickups. This is public
  // information: everybody saw these cards before they entered the player's hand.
  if (typeof pickupDiscard === 'function') {
    const pickupBeforeStatus0920 = pickupDiscard;
    pickupDiscard = function pickupWithPublicMemory0920(name) {
      const publicPile = (state.discard || []).map((card) => ({ rank: card.rank, suit: card.suit }));
      const result = pickupBeforeStatus0920(name);
      rememberKnownCards(name, publicPile);
      return result;
    };
  }

  let previousDiscard = (state.discard || []).map((card) => ({ rank: card.rank, suit: card.suit }));

  function updateBlindPublicMemory() {
    PLAYER_NAMES.forEach(ensureKnownHand);
    const message = String(state.lastMessage || '');
    if (!previousDiscard.length || !/turned over .*picked up|turned over .*can.t go/i.test(message)) return;

    const actor = PLAYER_NAMES.find((name) => message.startsWith(`${publicName(name)} turned over `));
    if (!actor) return;
    const match = message.match(/turned over ([^\s]+)(?:\s|—|and)/i);
    const revealedText = match?.[1] || '';
    const revealed = (state.players?.[actor]?.hand || []).find((card) => cardText(card) === revealedText);
    rememberKnownCards(actor, previousDiscard.concat(revealed ? [revealed] : []));
  }

  function playerCardCount(name) {
    const player = state.players?.[name];
    if (!player) return 0;
    const slots = Array.isArray(player.tableSlots) && player.tableSlots.length
      ? player.tableSlots
      : [0, 1, 2].map((index) => ({ faceUp: player.faceUp?.[index] || null, faceDown: player.faceDown?.[index] || null }));
    return (player.hand?.length || 0)
      + slots.filter((slot) => !!slot?.faceUp).length
      + slots.filter((slot) => !!slot?.faceDown).length;
  }

  function calibratedRisk() {
    const engine = window.ShitHeadPublicRiskV1;
    if (!engine || !state.players || state.phase === 'lobby') return null;

    const active = PLAYER_NAMES.filter((name) => playerCardCount(name) > 0);
    const temperature = (state.drawPile?.length || 0) > 0
      ? CALIBRATION.temperatures.draw
      : active.length === 2
        ? CALIBRATION.temperatures.twoPlayer
        : CALIBRATION.temperatures.tableThree;

    try {
      return engine.calculatePublicShitheadProbability(state, {
        viewerId: state.viewer,
        temperature,
        burden: CALIBRATION.burden,
        cardQualityWeight: CALIBRATION.cardQualityWeight,
        pickupBase: CALIBRATION.pickupBase,
        pickupLogWeight: CALIBRATION.pickupLogWeight,
      });
    } catch (error) {
      console.warn('Shithead Risk could not be calculated', error);
      return null;
    }
  }

  function canEditOwnDrink(name) {
    if (name !== state.viewer) return false;
    const mp = window.ShitHeadMultiplayer?.status;
    if (!mp || mp.role === 'local') return true;
    // Online drink choices are part of setup state so everyone sees the same table.
    return state.phase === 'setup';
  }

  function closeDrinkPicker() {
    document.querySelector('.drink-picker')?.remove();
  }

  function openDrinkPicker(name, anchor) {
    if (!canEditOwnDrink(name)) return;
    closeDrinkPicker();

    const picker = document.createElement('div');
    picker.className = 'drink-picker';
    picker.setAttribute('role', 'dialog');
    picker.setAttribute('aria-label', `Choose ${publicName(name)}'s drink`);

    const title = document.createElement('p');
    title.className = 'drink-picker-title';
    title.textContent = 'What are you drinking?';

    const grid = document.createElement('div');
    grid.className = 'drink-picker-grid';
    const current = ensurePlayerDrink(name);
    Object.entries(DRINKS).forEach(([id, drink]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `drink-picker-option${id === current ? ' selected' : ''}`;
      button.dataset.drink = id;
      button.innerHTML = `<span class="drink-picker-icon" aria-hidden="true">${drink.icon}</span><span class="drink-picker-label">${drink.label}</span>`;
      button.addEventListener('click', () => {
        if (state.players?.[name]) state.players[name].drink = id;
        localStorage.setItem(`shithead-drink-${name}`, id);
        closeDrinkPicker();
        render();
        const mp = window.ShitHeadMultiplayer?.status;
        if (mp?.role === 'host') window.ShitHeadMultiplayer.publishState();
        else if (mp?.role === 'client' && state.phase === 'setup') window.ShitHeadMultiplayer.publishState();
      });
      grid.append(button);
    });

    picker.append(title, grid);
    document.body.append(picker);
    const rect = anchor.getBoundingClientRect();
    const pickerRect = picker.getBoundingClientRect();
    let left = rect.left + rect.width / 2 - pickerRect.width / 2;
    left = Math.max(12, Math.min(left, window.innerWidth - pickerRect.width - 12));
    let top = rect.top - pickerRect.height - 10;
    if (top < 12) top = Math.min(window.innerHeight - pickerRect.height - 12, rect.bottom + 10);
    picker.style.left = `${left}px`;
    picker.style.top = `${Math.max(12, top)}px`;

    setTimeout(() => {
      document.addEventListener('pointerdown', function outside(event) {
        if (picker.contains(event.target) || anchor.contains(event.target)) return;
        closeDrinkPicker();
        document.removeEventListener('pointerdown', outside);
      });
    }, 0);
  }

  // Replace the old identity-heavy coaster. It now contains only the selected drink.
  makeBeerMat = function makeDrinkCoaster0920(name, extraClass = '', editable = false) {
    const drinkId = ensurePlayerDrink(name);
    const drink = DRINKS[drinkId] || DRINKS.wine;
    const canEdit = editable && canEditOwnDrink(name);
    const mat = document.createElement(canEdit ? 'button' : 'div');
    if (canEdit) mat.type = 'button';
    mat.className = `beer-mat ${extraClass}${canEdit ? ' drink-editable' : ''}`.trim();
    mat.dataset.player = name;
    mat.dataset.drink = drinkId;

    const glass = document.createElement('span');
    glass.className = 'beer-mat-drink';
    glass.textContent = drink.icon;
    glass.setAttribute('aria-hidden', 'true');
    mat.append(glass);

    mat.setAttribute('aria-label', `${publicName(name)}: ${drink.label}${canEdit ? '. Click to choose drink.' : ''}`);
    if (canEdit) mat.addEventListener('click', () => openDrinkPicker(name, mat));
    return mat;
  };

  function makeNotepad(name, probabilities) {
    const pad = document.createElement('aside');
    pad.className = `player-notepad${playerCardCount(name) === 0 ? ' player-out' : ''}`;
    pad.dataset.player = name;

    const own = name === state.viewer;
    const nameEl = document.createElement(own ? 'button' : 'div');
    if (own) nameEl.type = 'button';
    nameEl.className = 'notepad-name';
    nameEl.textContent = publicName(name);
    nameEl.title = own ? 'Change this week’s name' : publicName(name);
    if (own) nameEl.addEventListener('click', () => editDisplayName(name));

    const scoreRow = document.createElement('div');
    scoreRow.className = 'notepad-row notepad-score';
    scoreRow.innerHTML = `<span>Score</span><strong class="notepad-value">${Number(state.scores?.[name] ?? PLAYER_PROFILE?.[name]?.score ?? 0)}</strong>`;

    const risk = probabilities && Number.isFinite(probabilities[name]) ? Math.round(probabilities[name]) : null;
    const riskRow = document.createElement('div');
    riskRow.className = 'notepad-row notepad-risk';
    riskRow.innerHTML = `<span>Shithead</span><strong class="notepad-value">${risk === null ? '—' : `${risk}%`}</strong>`;

    pad.append(nameEl, scoreRow, riskRow);
    pad.setAttribute('aria-label', `${publicName(name)}, score ${Number(state.scores?.[name] ?? 0)}, Shithead Risk ${risk === null ? 'not available' : `${risk} percent`}`);
    return pad;
  }

  function decoratePlayerNotepads() {
    const probabilities = calibratedRisk();
    [opponentLeft, opponentRight, playerSeat].forEach((seat) => seat?.querySelector('.player-notepad')?.remove());
    const seats = seatingForViewer();
    opponentLeft?.append(makeNotepad(seats.left, probabilities));
    opponentRight?.append(makeNotepad(seats.right, probabilities));
    playerSeat?.append(makeNotepad(seats.self, probabilities));
  }

  const renderBeforeStatus0920 = render;
  render = function renderWithPlayerStatus0920() {
    updateBlindPublicMemory();
    renderBeforeStatus0920();
    decoratePlayerNotepads();
    previousDiscard = (state.discard || []).map((card) => ({ rank: card.rank, suit: card.suit }));
  };

  // Initial pass replaces the old coaster contents immediately.
  render();
})();
