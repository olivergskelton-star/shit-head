// Build 0.9.22: runtime for the chunked tabletop WebP atlas.
// Keeps artwork separate from game rules and multiplayer state.
(() => {
  const BUILD = window.SHITHEAD_BUILD || '0.9.22';
  const PARTS = 6;
  const COLS = 5;
  const ROWS = 4;

  const SPRITES = Object.freeze({
    coffee: [0, 0],
    'craft-beer': [1, 0],
    guinness: [2, 0],
    tea: [3, 0],
    'jd-coke': [4, 0],
    lager: [0, 1],
    lemonade: [1, 1],
    martini: [2, 1],
    milk: [3, 1],
    mojito: [4, 1],
    'pina-colada': [0, 2],
    'red-wine': [1, 2],
    'herbal-tea': [2, 2],
    'white-wine': [3, 2],
    'coaster-casino': [4, 2],
    'coaster-kitchen': [0, 3],
    'coaster-pub': [1, 3],
    'snack-crisps': [2, 3],
    'snack-nuts': [3, 3],
    'snack-olives': [4, 3],
  });

  const DRINKS = Object.freeze({
    'red-wine': { label: 'Red Wine', sprite: 'red-wine', icon: '🍷' },
    'white-wine': { label: 'White Wine', sprite: 'white-wine', icon: '🥂' },
    lager: { label: 'Lager', sprite: 'lager', icon: '🍺' },
    'craft-beer': { label: 'Craft Beer', sprite: 'craft-beer', icon: '🍺' },
    guinness: { label: 'Guinness', sprite: 'guinness', icon: '🍺' },
    coffee: { label: 'Coffee', sprite: 'coffee', icon: '☕' },
    tea: { label: 'Tea', sprite: 'tea', icon: '🍵' },
    'herbal-tea': { label: 'Herbal Tea', sprite: 'herbal-tea', icon: '🍵' },
    milk: { label: 'Milk', sprite: 'milk', icon: '🥛' },
    lemonade: { label: 'Lemonade', sprite: 'lemonade', icon: '🍋' },
    martini: { label: 'Martini', sprite: 'martini', icon: '🍸' },
    'jd-coke': { label: 'JD & Coke', sprite: 'jd-coke', icon: '🥃' },
    'pina-colada': { label: 'Piña Colada', sprite: 'pina-colada', icon: '🍹' },
    mojito: { label: 'Mojito', sprite: 'mojito', icon: '🍹' },
  });

  const ALIASES = Object.freeze({ wine: 'red-wine', beer: 'lager' });
  const DEFAULTS = Object.freeze({ Oliver: 'red-wine', Dan: 'lager', Chris: 'martini' });
  const COASTERS = Object.freeze({ kitchen: 'coaster-kitchen', pub: 'coaster-pub', casino: 'coaster-casino' });
  const SNACKS = Object.freeze({ kitchen: 'snack-nuts', pub: 'snack-crisps', casino: 'snack-olives' });

  let atlasUrl = null;
  let loading = null;

  function canonicalDrink(id) {
    const normalized = ALIASES[id] || id;
    return DRINKS[normalized] ? normalized : null;
  }

  function getDrink(name) {
    const player = state.players?.[name];
    const saved = localStorage.getItem(`shithead-drink-${name}`);
    const id = canonicalDrink(player?.drink) || canonicalDrink(saved) || DEFAULTS[name] || 'red-wine';
    if (player && player.drink !== id) player.drink = id;
    if (saved !== id) localStorage.setItem(`shithead-drink-${name}`, id);
    return id;
  }

  function canEdit(name) {
    if (name !== state.viewer) return false;
    const mp = window.ShitHeadMultiplayer?.status;
    return !mp || mp.role === 'local' || state.phase === 'setup';
  }

  function fallback(drink, className) {
    const span = document.createElement('span');
    span.className = className;
    span.textContent = drink.icon;
    span.setAttribute('aria-hidden', 'true');
    return span;
  }

  function sprite(key, className) {
    const pos = SPRITES[key];
    if (!atlasUrl || !pos) return null;
    const [col, row] = pos;
    const span = document.createElement('span');
    span.className = `asset-sprite ${className}`;
    span.dataset.sprite = key;
    span.setAttribute('aria-hidden', 'true');
    span.style.backgroundImage = `url("${atlasUrl}")`;
    span.style.backgroundSize = `${COLS * 100}% ${ROWS * 100}%`;
    span.style.backgroundPosition = `${col * 25}% ${row * (100 / 3)}%`;
    return span;
  }

  function drinkVisual(drink, spriteClass, fallbackClass) {
    return sprite(drink.sprite, spriteClass) || fallback(drink, fallbackClass);
  }

  function closePicker() {
    document.querySelector('.drink-picker')?.remove();
  }

  function publishCosmeticState() {
    const mp = window.ShitHeadMultiplayer?.status;
    if (mp?.role === 'host') window.ShitHeadMultiplayer.publishState();
    else if (mp?.role === 'client' && state.phase === 'setup') window.ShitHeadMultiplayer.publishState();
  }

  function openPicker(name, anchor) {
    if (!canEdit(name)) return;
    closePicker();

    const picker = document.createElement('div');
    picker.className = 'drink-picker asset-drink-picker';
    picker.setAttribute('role', 'dialog');
    picker.setAttribute('aria-label', `Choose ${publicName(name)}'s drink`);

    const title = document.createElement('p');
    title.className = 'drink-picker-title';
    title.textContent = 'What are you drinking?';

    const grid = document.createElement('div');
    grid.className = 'drink-picker-grid';
    const current = getDrink(name);

    Object.entries(DRINKS).forEach(([id, drink]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `drink-picker-option${id === current ? ' selected' : ''}`;
      button.dataset.drink = id;
      button.append(drinkVisual(drink, 'drink-picker-asset', 'drink-picker-icon asset-fallback'));

      const label = document.createElement('span');
      label.className = 'drink-picker-label';
      label.textContent = drink.label;
      button.append(label);

      button.addEventListener('click', () => {
        if (state.players?.[name]) state.players[name].drink = id;
        localStorage.setItem(`shithead-drink-${name}`, id);
        closePicker();
        render();
        publishCosmeticState();
      });
      grid.append(button);
    });

    picker.append(title, grid);
    document.body.append(picker);
    const rect = anchor.getBoundingClientRect();
    const box = picker.getBoundingClientRect();
    let left = rect.left + rect.width / 2 - box.width / 2;
    left = Math.max(12, Math.min(left, window.innerWidth - box.width - 12));
    let top = rect.top - box.height - 10;
    if (top < 12) top = Math.min(window.innerHeight - box.height - 12, rect.bottom + 10);
    picker.style.left = `${left}px`;
    picker.style.top = `${Math.max(12, top)}px`;

    setTimeout(() => {
      document.addEventListener('pointerdown', function outside(event) {
        if (picker.contains(event.target) || anchor.contains(event.target)) return;
        closePicker();
        document.removeEventListener('pointerdown', outside);
      });
    }, 0);
  }

  makeBeerMat = function makeAtlasBeerMat0922(name, extraClass = '', editable = false) {
    const id = getDrink(name);
    const drink = DRINKS[id] || DRINKS['red-wine'];
    const editableNow = editable && canEdit(name);
    const mat = document.createElement(editableNow ? 'button' : 'div');
    if (editableNow) mat.type = 'button';
    mat.className = `beer-mat ${extraClass}${editableNow ? ' drink-editable' : ''}`.trim();
    mat.dataset.player = name;
    mat.dataset.drink = id;

    const theme = document.body.dataset.theme || 'kitchen';
    const coaster = sprite(COASTERS[theme] || COASTERS.kitchen, 'beer-mat-coaster-asset');
    if (coaster) {
      mat.append(coaster);
      mat.classList.add('assets-ready');
    }
    mat.append(drinkVisual(drink, 'beer-mat-drink-asset', 'beer-mat-drink'));
    mat.setAttribute('aria-label', `${publicName(name)}: ${drink.label}${editableNow ? '. Click to choose drink.' : ''}`);
    if (editableNow) mat.addEventListener('click', () => openPicker(name, mat));
    return mat;
  };

  function decorateSnack() {
    if (!playerSeat) return;
    playerSeat.querySelector('.player-snack-bowl')?.remove();
    const theme = document.body.dataset.theme || 'kitchen';
    const bowl = sprite(SNACKS[theme] || SNACKS.kitchen, 'player-snack-bowl');
    if (bowl) playerSeat.append(bowl);
  }

  const renderBeforeAtlas = render;
  render = function renderWithAtlas0922() {
    renderBeforeAtlas();
    decorateSnack();
  };

  async function loadAtlas() {
    if (atlasUrl) return atlasUrl;
    if (loading) return loading;
    loading = Promise.all(Array.from({ length: PARTS }, async (_, index) => {
      const part = String(index).padStart(2, '0');
      const response = await fetch(`assets/atlas/part-${part}.txt?v=${BUILD}`);
      if (!response.ok) throw new Error(`Atlas part ${part} failed: ${response.status}`);
      return (await response.text()).trim();
    })).then((parts) => {
      atlasUrl = `data:image/webp;base64,${parts.join('')}`;
      return new Promise((resolve, reject) => {
        const probe = new Image();
        probe.onload = () => resolve(atlasUrl);
        probe.onerror = () => reject(new Error('Tabletop atlas could not be decoded'));
        probe.src = atlasUrl;
      });
    }).then((url) => {
      render();
      return url;
    }).catch((error) => {
      console.warn('Tabletop artwork unavailable; keeping visual fallbacks.', error);
      loading = null;
      return null;
    });
    return loading;
  }

  window.ShitHeadTableAssets0922 = Object.freeze({ drinks: DRINKS, coasters: COASTERS, snacks: SNACKS, sprites: SPRITES, loadAtlas });
  render();
  loadAtlas();
})();
