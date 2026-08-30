// Build 0.9.22: photoreal drink/coaster/snack assets.
// This layer deliberately changes visuals only. Game rules and risk maths stay untouched.
(() => {
  const DRINKS = Object.freeze({
    'red-wine': { label: 'Red Wine', asset: 'assets/drinks/red-wine.png', icon: '🍷' },
    'white-wine': { label: 'White Wine', asset: 'assets/drinks/white-wine.png', icon: '🥂' },
    lager: { label: 'Lager', asset: 'assets/drinks/lager.png', icon: '🍺' },
    'craft-beer': { label: 'Craft Beer', asset: 'assets/drinks/craft-beer.png', icon: '🍺' },
    guinness: { label: 'Guinness', asset: 'assets/drinks/guinness.png', icon: '🍺' },
    coffee: { label: 'Coffee', asset: 'assets/drinks/coffee.png', icon: '☕' },
    tea: { label: 'Tea', asset: 'assets/drinks/tea.png', icon: '🍵' },
    'herbal-tea': { label: 'Herbal Tea', asset: 'assets/drinks/herbal-tea.png', icon: '🍵' },
    milk: { label: 'Milk', asset: 'assets/drinks/milk.png', icon: '🥛' },
    lemonade: { label: 'Lemonade', asset: 'assets/drinks/lemonade.png', icon: '🍋' },
    martini: { label: 'Martini', asset: 'assets/drinks/martini.png', icon: '🍸' },
    'jd-coke': { label: 'JD & Coke', asset: 'assets/drinks/jd-coke.png', icon: '🥃' },
    'pina-colada': { label: 'Piña Colada', asset: 'assets/drinks/pina-colada.png', icon: '🍹' },
    mojito: { label: 'Mojito', asset: 'assets/drinks/mojito.png', icon: '🍹' },
    // G&T remains available as an emoji fallback until its PNG joins the asset folder.
    'gin-tonic': { label: 'G&T', asset: null, icon: '🍸' },
  });

  const ALIASES = Object.freeze({ wine: 'red-wine', beer: 'lager' });
  const DEFAULT_DRINK = Object.freeze({ Oliver: 'red-wine', Dan: 'lager', Chris: 'gin-tonic' });
  const COASTERS = Object.freeze({
    kitchen: 'assets/coasters/kitchen.png',
    pub: 'assets/coasters/pub.png',
    casino: 'assets/coasters/casino.png',
  });
  const SNACKS = Object.freeze({
    kitchen: 'assets/snacks/nuts.png',
    pub: 'assets/snacks/crisps.png',
    casino: 'assets/snacks/olives.png',
  });

  function canonicalDrink(id) {
    const normalized = ALIASES[id] || id;
    return DRINKS[normalized] ? normalized : null;
  }

  function playerDrink(name) {
    const player = state.players?.[name];
    const saved = localStorage.getItem(`shithead-drink-${name}`);
    const current = canonicalDrink(player?.drink) || canonicalDrink(saved) || DEFAULT_DRINK[name] || 'red-wine';
    if (player && player.drink !== current) player.drink = current;
    if (saved !== current) localStorage.setItem(`shithead-drink-${name}`, current);
    return current;
  }

  function canEditOwnDrink(name) {
    if (name !== state.viewer) return false;
    const mp = window.ShitHeadMultiplayer?.status;
    if (!mp || mp.role === 'local') return true;
    return state.phase === 'setup';
  }

  function fallbackIcon(drink, className = 'drink-picker-icon asset-fallback') {
    const span = document.createElement('span');
    span.className = className;
    span.textContent = drink.icon;
    span.setAttribute('aria-hidden', 'true');
    return span;
  }

  function drinkImage(drink, className, fallbackClass) {
    if (!drink.asset) return fallbackIcon(drink, fallbackClass);
    const image = document.createElement('img');
    image.className = className;
    image.src = drink.asset;
    image.alt = '';
    image.decoding = 'async';
    image.draggable = false;
    image.addEventListener('error', () => image.replaceWith(fallbackIcon(drink, fallbackClass)), { once: true });
    return image;
  }

  function closePicker() {
    document.querySelector('.drink-picker')?.remove();
  }

  function publishCosmeticSetupState() {
    const mp = window.ShitHeadMultiplayer?.status;
    if (mp?.role === 'host') window.ShitHeadMultiplayer.publishState();
    else if (mp?.role === 'client' && state.phase === 'setup') window.ShitHeadMultiplayer.publishState();
  }

  function openPicker(name, anchor) {
    if (!canEditOwnDrink(name)) return;
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
    const current = playerDrink(name);

    Object.entries(DRINKS).forEach(([id, drink]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `drink-picker-option${id === current ? ' selected' : ''}`;
      button.dataset.drink = id;
      button.append(drinkImage(drink, 'drink-picker-asset', 'drink-picker-icon asset-fallback'));

      const label = document.createElement('span');
      label.className = 'drink-picker-label';
      label.textContent = drink.label;
      button.append(label);

      button.addEventListener('click', () => {
        if (state.players?.[name]) state.players[name].drink = id;
        localStorage.setItem(`shithead-drink-${name}`, id);
        closePicker();
        render();
        publishCosmeticSetupState();
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
        closePicker();
        document.removeEventListener('pointerdown', outside);
      });
    }, 0);
  }

  // Replace the emoji-only beer mat with two independent visual layers:
  // venue coaster underneath + the player's chosen drink above it.
  makeBeerMat = function makePhotorealBeerMat0922(name, extraClass = '', editable = false) {
    const drinkId = playerDrink(name);
    const drink = DRINKS[drinkId] || DRINKS['red-wine'];
    const canEdit = editable && canEditOwnDrink(name);
    const mat = document.createElement(canEdit ? 'button' : 'div');
    if (canEdit) mat.type = 'button';
    mat.className = `beer-mat ${extraClass}${canEdit ? ' drink-editable' : ''}`.trim();
    mat.dataset.player = name;
    mat.dataset.drink = drinkId;

    const theme = document.body.dataset.theme || 'kitchen';
    const coasterAsset = COASTERS[theme] || COASTERS.kitchen;
    const coaster = document.createElement('img');
    coaster.className = 'beer-mat-coaster-asset';
    coaster.src = coasterAsset;
    coaster.alt = '';
    coaster.decoding = 'async';
    coaster.draggable = false;
    coaster.addEventListener('load', () => mat.classList.add('assets-ready'), { once: true });
    coaster.addEventListener('error', () => coaster.remove(), { once: true });
    mat.append(coaster);

    mat.append(drinkImage(drink, 'beer-mat-drink-asset', 'beer-mat-drink'));
    mat.setAttribute('aria-label', `${publicName(name)}: ${drink.label}${canEdit ? '. Click to choose drink.' : ''}`);
    if (canEdit) mat.addEventListener('click', () => openPicker(name, mat));
    return mat;
  };

  function decorateSnack() {
    if (!playerSeat) return;
    playerSeat.querySelector('.player-snack-bowl')?.remove();
    const theme = document.body.dataset.theme || 'kitchen';
    const asset = SNACKS[theme] || SNACKS.kitchen;
    const bowl = document.createElement('img');
    bowl.className = 'player-snack-bowl';
    bowl.src = asset;
    bowl.alt = '';
    bowl.decoding = 'async';
    bowl.draggable = false;
    bowl.setAttribute('aria-hidden', 'true');
    bowl.addEventListener('error', () => bowl.remove(), { once: true });
    playerSeat.append(bowl);
  }

  const renderBeforeAssets0922 = render;
  render = function renderWithTableAssets0922() {
    renderBeforeAssets0922();
    decorateSnack();
  };

  window.ShitHeadTableAssets0922 = Object.freeze({
    drinks: DRINKS,
    coasters: COASTERS,
    snacks: SNACKS,
  });

  render();
})();
