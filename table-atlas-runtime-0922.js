// Build 0.9.26: direct tabletop PNG assets.
// No atlas reconstruction, base64 chunks, Blob URLs or sprite coordinates.
(() => {
  const BUILD = window.SHITHEAD_BUILD || '0.9.26';
  const ASSET_DIR = 'assets/table';

  const DRINKS = Object.freeze({
    'red-wine': { label: 'Red Wine', file: 'red-wine.png', icon: '🍷' },
    'white-wine': { label: 'White Wine', file: 'white-wine.png', icon: '🥂' },
    lager: { label: 'Lager', file: 'lager.png', icon: '🍺' },
    'craft-beer': { label: 'Craft Beer', file: 'craft-beer.png', icon: '🍺' },
    guinness: { label: 'Guinness', file: 'guinness.png', icon: '🍺' },
    coffee: { label: 'Coffee', file: 'coffee.png', icon: '☕' },
    tea: { label: 'Tea', file: 'tea.png', icon: '🍵' },
    'herbal-tea': { label: 'Herbal Tea', file: 'herbal-tea.png', icon: '🍵' },
    milk: { label: 'Milk', file: 'milk.png', icon: '🥛' },
    lemonade: { label: 'Lemonade', file: 'lemonade.png', icon: '🍋' },
    martini: { label: 'Martini', file: 'martini.png', icon: '🍸' },
    'jd-coke': { label: 'JD & Coke', file: 'jd-coke.png', icon: '🥃' },
    'pina-colada': { label: 'Piña Colada', file: 'pina-colada.png', icon: '🍹' },
    mojito: { label: 'Mojito', file: 'mojito.png', icon: '🍹' },
  });

  const ALIASES = Object.freeze({ wine: 'red-wine', beer: 'lager' });
  const DEFAULTS = Object.freeze({ Oliver: 'red-wine', Dan: 'lager', Chris: 'martini' });
  const COASTERS = Object.freeze({
    kitchen: 'coaster-kitchen.png',
    pub: 'coaster-pub.png',
    casino: 'coaster-casino.png',
  });
  const SNACKS = Object.freeze({
    kitchen: 'snack-nuts.png',
    pub: 'snack-crisps.png',
    casino: 'snack-olives.png',
  });

  const ALL_FILES = Object.freeze([
    ...Object.values(DRINKS).map((drink) => drink.file),
    ...Object.values(COASTERS),
    ...Object.values(SNACKS),
  ]);

  let loading = null;
  let assetsReady = false;

  function assetUrl(file) {
    return `${ASSET_DIR}/${file}?v=${BUILD}`;
  }

  function canonicalDrink(id) {
    const normalized = ALIASES[id] || id;
    return DRINKS[normalized] ? normalized : null;
  }

  function getDrink(name) {
    const player = state.players?.[name];
    const saved = canonicalDrink(localStorage.getItem(`shithead-drink-${name}`));
    const current = canonicalDrink(player?.drink);
    const mp = window.ShitHeadMultiplayer?.status;
    const ownsSeat = name === state.viewer;
    const onlineSetup = mp?.role === 'client' && (state.phase === 'lobby' || state.phase === 'setup');

    const id = (ownsSeat && onlineSetup ? saved : current)
      || current
      || saved
      || DEFAULTS[name]
      || 'red-wine';

    if (player && player.drink !== id) player.drink = id;
    if (saved !== id) localStorage.setItem(`shithead-drink-${name}`, id);
    return id;
  }

  function canEdit(name) {
    if (name !== state.viewer) return false;
    const mp = window.ShitHeadMultiplayer?.status;
    return !mp || mp.role === 'local' || state.phase === 'setup';
  }

  function directVisual(file, className, fallbackIcon = '') {
    const frame = document.createElement('span');
    frame.className = `asset-direct-frame ${className}`;
    frame.dataset.asset = file;
    frame.setAttribute('aria-hidden', 'true');

    const image = document.createElement('img');
    image.className = 'asset-direct-image';
    image.alt = '';
    image.draggable = false;
    image.decoding = 'async';
    image.src = assetUrl(file);
    frame.append(image);

    if (fallbackIcon) {
      const fallback = document.createElement('span');
      fallback.className = 'asset-direct-fallback';
      fallback.textContent = fallbackIcon;
      fallback.setAttribute('aria-hidden', 'true');
      frame.append(fallback);
    }

    const markLoaded = () => {
      if (image.naturalWidth > 0) frame.classList.add('asset-loaded');
    };
    image.addEventListener('load', markLoaded, { once: true });
    if (image.complete) markLoaded();
    return frame;
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
      button.append(directVisual(drink.file, 'drink-picker-asset', drink.icon));

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

  makeBeerMat = function makeDirectAssetBeerMat0926(name, extraClass = '', editable = false) {
    const id = getDrink(name);
    const drink = DRINKS[id] || DRINKS['red-wine'];
    const editableNow = editable && canEdit(name);
    const mat = document.createElement(editableNow ? 'button' : 'div');
    if (editableNow) mat.type = 'button';
    mat.className = `beer-mat ${extraClass}${editableNow ? ' drink-editable' : ''}`.trim();
    mat.dataset.player = name;
    mat.dataset.drink = id;

    const theme = document.body.dataset.theme || 'kitchen';
    const coaster = directVisual(COASTERS[theme] || COASTERS.kitchen, 'beer-mat-coaster-asset');
    mat.append(coaster);
    const coasterImage = coaster.querySelector('.asset-direct-image');
    const showRealCoaster = () => {
      if (coasterImage?.naturalWidth > 0) mat.classList.add('assets-ready');
    };
    coasterImage?.addEventListener('load', showRealCoaster, { once: true });
    if (coasterImage?.complete) showRealCoaster();

    mat.append(directVisual(drink.file, 'beer-mat-drink-asset', drink.icon));
    mat.setAttribute('aria-label', `${publicName(name)}: ${drink.label}${editableNow ? '. Click to choose drink.' : ''}`);
    if (editableNow) mat.addEventListener('click', () => openPicker(name, mat));
    return mat;
  };

  function decorateSnack() {
    if (!playerSeat) return;
    playerSeat.querySelector('.player-snack-bowl')?.remove();
    const theme = document.body.dataset.theme || 'kitchen';
    playerSeat.append(directVisual(SNACKS[theme] || SNACKS.kitchen, 'player-snack-bowl'));
  }

  const renderBeforeAssets = render;
  render = function renderWithDirectAssets0926() {
    renderBeforeAssets();
    decorateSnack();
  };

  function preload(file) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(file);
      image.onerror = () => reject(new Error(`Direct table asset failed: ${file}`));
      image.src = assetUrl(file);
    });
  }

  async function loadAssets() {
    if (assetsReady) return true;
    if (loading) return loading;

    document.documentElement.dataset.tableAssets = 'loading';
    loading = Promise.all(ALL_FILES.map(preload)).then(() => {
      assetsReady = true;
      document.documentElement.dataset.tableAssets = 'ready';
      render();
      return true;
    }).catch((error) => {
      console.warn('Direct tabletop artwork unavailable; keeping visual fallbacks.', error);
      assetsReady = false;
      document.documentElement.dataset.tableAssets = 'fallback';
      loading = null;
      return false;
    });
    return loading;
  }

  window.ShitHeadTableAssets0922 = Object.freeze({
    drinks: DRINKS,
    coasters: COASTERS,
    snacks: SNACKS,
    loadAssets,
    loadAtlas: loadAssets,
  });

  render();
  loadAssets();
})();
