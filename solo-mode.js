// Solo uses the live rules engine. CPU decisions receive only their own hand,
// visible table cards, public pile and anonymous bottom-card positions.
(() => {
  const SAVE = 'shithead-solo-v1';
  const ACTIVE = 'shithead-solo-active';
  let active = false, paused = false, timer = null, writing = false;
  const api = window.ShitHeadTablePlay;
  const visited = new Map();
  const button = document.createElement('button');
  button.id = 'soloPlay';
  button.textContent = 'Play solo';
  document.querySelector('.controls').prepend(button);
  const status = document.createElement('span');
  status.id = 'offlineStatus';
  status.setAttribute('role', 'status');
  status.textContent = 'Preparing offline play…';
  document.querySelector('#buildBadge').after(status);
  const dialog = document.createElement('dialog');
  dialog.id = 'soloDialog';
  dialog.innerHTML = `<h2>Play solo</h2><p>You against two computer players, using the house rules.</p>
    <p id="soloSaveInfo"></p><div class="solo-actions"><button id="soloResume">Resume game</button>
    <button id="soloNew">New solo game</button><button id="soloClose">Back to table</button></div>
    <p class="solo-help">Before travelling, wait for “Ready for offline play”. Save this page to your home screen or bookmark it. Games save on this device.</p>`;
  document.body.append(dialog);
  const info = dialog.querySelector('#soloSaveInfo');
  const read = () => { try { return JSON.parse(localStorage.getItem(SAVE)); } catch { return null; } };
  function valid(save) {
    const s = save?.state;
    if (save?.version !== 1 || !s || !PLAYER_NAMES.includes(s.viewer) || !['setup','play','gameover'].includes(s.phase)) return false;
    if (!Array.isArray(s.drawPile) || !Array.isArray(s.discard) || !Array.isArray(s.burnPile)) return false;
    const cards = [...s.drawPile, ...s.discard, ...s.burnPile];
    for (const name of PLAYER_NAMES) {
      const p = s.players?.[name];
      if (!p || !Array.isArray(p.hand) || !Array.isArray(p.faceUp) || !Array.isArray(p.faceDown)) return false;
      cards.push(...p.hand);
      if (s.phase === 'setup') cards.push(...p.faceUp, ...p.faceDown);
      else {
        if (!Array.isArray(p.tableSlots) || p.tableSlots.length !== 3) return false;
        cards.push(...p.tableSlots.flatMap(slot => [slot?.faceUp, slot?.faceDown]).filter(Boolean));
      }
    }
    return cards.length === 52 && cards.every(c => RANKS.includes(c?.rank) && SUITS.includes(c?.suit)) && new Set(cards.map(cardText)).size === 52;
  }
  function save() {
    if (!active || writing) return;
    try {
      localStorage.setItem(SAVE, JSON.stringify({ version: 1, savedAt: Date.now(), state }));
      localStorage.setItem(ACTIVE, '1');
      button.title = 'Game saved on this device';
    } catch { button.title = 'Saving unavailable'; info.textContent = 'This browser could not save your game. Keep the tab open to continue.'; }
  }
  function stop() {
    save(); active = false; clearTimeout(timer); timer = null;
    try { localStorage.removeItem(ACTIVE); } catch {}
    viewerSelect.disabled = false;
    button.textContent = 'Play solo';
    document.body.classList.remove('solo-mode');
  }
  function enter() {
    window.ShitHeadMultiplayer?.disconnect();
    active = true; paused = false;
    document.body.classList.add('solo-mode');
    viewerSelect.disabled = true;
    button.textContent = 'Solo · pause';
  }
  function strength(rank) { return ({'10':30,'2':26,'3':24,'A':20,'K':18,'Q':16,'J':14,'7':12})[rank] || Number(rank); }
  function arrangeCPUs() {
    for (const name of PLAYER_NAMES.filter(n => n !== state.viewer)) {
      const p = state.players[name];
      const known = [...p.hand, ...p.faceUp].sort((a,b) => strength(b.rank)-strength(a.rank));
      p.faceUp = known.slice(0,3); p.hand = known.slice(3);
      delete p.tableSlots;
      state.setupReady[name] = true;
      state.setupReadyOrder.push(name);
    }
  }
  function fresh() {
    visited.clear();
    writing = true;
    enter();
    newGameBtn.click(); // Run every existing deal/reset listener in its normal order.
    state.scores = Object.fromEntries(PLAYER_NAMES.map(n => [n, 0]));
    arrangeCPUs();
    state.lastMessage = 'Solo game — arrange your cards, then press READY. Both computer players are ready.';
    writing = false;
    dialog.close(); render();
  }
  function resume() {
    const stored = read();
    if (!valid(stored)) { info.textContent = 'The saved game cannot be restored. Start a new solo game.'; return; }
    writing = true; enter();
    // Remove optional state from the previous deal before restoring this one.
    for (const key of Object.keys(state)) delete state[key];
    Object.assign(state, stored.state);
    state.selected = []; state.selectedRefs = []; state.setupSelection = null;
    viewerSelect.value = state.viewer; viewerSelect.disabled = true;
    themeSelect.value = state.theme; document.body.dataset.theme = state.theme;
    writing = false; dialog.close(); render();
  }
  function observation(name) {
    return {
      hand: state.players[name].hand.map(c => ({...c})),
      slots: api.getSlots(name).map(s => ({faceUp: s.faceUp ? {...s.faceUp} : null, bottom: !!s.faceDown})),
      pile: state.discard.map(c => ({...c})), drawCount: state.drawPile.length,
      followUp: state.followUpRank,
    };
  }

  function cardTotal(player) {
    const slots = Array.isArray(player?.tableSlots) ? player.tableSlots : [];
    return (player?.hand?.length || 0)
      + slots.filter(slot => slot?.faceUp).length
      + slots.filter(slot => slot?.faceDown).length;
  }

  function strategySlots(player) {
    if (Array.isArray(player?.tableSlots) && player.tableSlots.length) {
      return [0, 1, 2].map(index => ({
        faceUp: player.tableSlots[index]?.faceUp ? {...player.tableSlots[index].faceUp} : null,
        // A covered card is deliberately represented only by its presence. The
        // CPU must not inspect a face-down identity while choosing a move.
        faceDown: player.tableSlots[index]?.faceDown ? {} : null,
      }));
    }
    return [0, 1, 2].map(index => ({
      faceUp: player?.faceUp?.[index] ? {...player.faceUp[index]} : null,
      faceDown: player?.faceDown?.[index] ? {} : null,
    }));
  }

  function strategyState(name) {
    const projected = JSON.parse(JSON.stringify(state));
    projected.viewer = name;
    projected.drawPile = (state.drawPile || []).map(() => ({}));
    projected.discard = (state.discard || []).map(card => ({...card}));
    projected.burnPile = (state.burnPile || []).map(card => ({...card}));
    projected.players = Object.fromEntries(Object.entries(state.players || {}).map(([id, source]) => {
      const slots = strategySlots(source);
      const hand = id === name
        ? (source.hand || []).map(card => ({...card}))
        : (source.hand || []).map(() => ({}));
      const knownHand = id === name
        ? hand.filter(card => typeof card.rank === 'string').map(card => ({...card}))
        : (Array.isArray(source.knownHand) ? source.knownHand : []).map(card => ({...card}));
      return [id, {
        ...source,
        hand,
        knownHand,
        tableSlots: slots,
        faceUp: slots.map(slot => slot.faceUp).filter(Boolean),
        faceDown: slots.map(slot => slot.faceDown).filter(Boolean),
      }];
    }));
    return projected;
  }

  function removeStrategyRefs(player, refs) {
    refs.filter(ref => ref.zone === 'hand')
      .map(ref => ref.index)
      .sort((a, b) => b - a)
      .forEach(index => player.hand.splice(index, 1));
    refs.filter(ref => ref.zone === 'faceUp')
      .forEach(ref => {
        if (player.tableSlots?.[ref.index]) player.tableSlots[ref.index].faceUp = null;
      });
    player.faceUp = (player.tableSlots || []).map(slot => slot.faceUp).filter(Boolean);
    player.faceDown = (player.tableSlots || []).map(slot => slot.faceDown).filter(Boolean);
  }

  function strategyBurns(rank, playedCount, discard) {
    if (rank === '10') return true;
    let run = 0;
    for (let index = (discard || []).length - 1; index >= 0; index -= 1) {
      if (discard[index]?.rank !== rank) break;
      run += 1;
    }
    const total = run + playedCount;
    return rank === '8' ? total >= 3 : total >= 4;
  }

  function strategyNextLiving(projected, fromName) {
    const ids = Object.keys(projected.players || {});
    const fromIndex = Math.max(0, ids.indexOf(fromName));
    const direction = projected.playDirection === -1 ? -1 : 1;
    for (let offset = 1; offset <= ids.length; offset += 1) {
      const index = (fromIndex + offset * direction + ids.length * 2) % ids.length;
      const candidate = ids[index];
      if (cardTotal(projected.players[candidate]) > 0) return candidate;
    }
    return null;
  }

  function strategyFinishTurn(projected, name, rank, burned) {
    const player = projected.players[name];
    const hasMatching = !burned && cardTotal(player) > 0
      && ((player.hand || []).some(card => card.rank === rank)
        || (projected.drawPile.length === 0 && (player.tableSlots || []).some(slot => slot.faceUp?.rank === rank)));

    if (burned && cardTotal(player) > 0) {
      projected.followUpRank = null;
      projected.currentPlayer = name;
      return;
    }
    if (hasMatching) {
      projected.followUpRank = rank;
      projected.currentPlayer = name;
      return;
    }

    projected.followUpRank = null;
    const next = strategyNextLiving(projected, name);
    projected.currentPlayer = next || name;
    const living = Object.keys(projected.players || {}).filter(id => cardTotal(projected.players[id]) > 0);
    if (living.length <= 1) {
      projected.phase = 'gameover';
      projected.shitHead = living[0] || null;
    }
  }

  function projectPlay(name, candidate) {
    const projected = strategyState(name);
    const player = projected.players[name];
    const cards = candidate.refs.map(ref => ref.zone === 'hand'
      ? player.hand[ref.index]
      : player.tableSlots?.[ref.index]?.faceUp).filter(Boolean).map(card => ({...card}));
    removeStrategyRefs(player, candidate.refs);
    projected.discard.push(...cards);

    // Until the draw pile is empty, a hand is replenished to three cards. The
    // identities of those new cards are unknown at decision time.
    while (projected.drawPile.length && player.hand.length < 3) {
      projected.drawPile.pop();
      player.hand.push({});
    }
    player.knownHand = player.hand.filter(card => typeof card.rank === 'string').map(card => ({...card}));

    const burned = strategyBurns(candidate.rank, cards.length, projected.discard.slice(0, -cards.length));
    if (burned) {
      projected.burnPile.push(...projected.discard);
      projected.discard = [];
    }
    strategyFinishTurn(projected, name, candidate.rank, burned);
    return {projected, burned, cards};
  }

  function projectPickup(name) {
    const projected = strategyState(name);
    const player = projected.players[name];
    player.hand.push(...projected.discard.map(card => ({...card})));
    projected.discard = [];
    player.knownHand = player.hand.filter(card => typeof card.rank === 'string').map(card => ({...card}));
    strategyFinishTurn(projected, name, null, false);
    projected.followUpRank = null;
    return projected;
  }

  function strategyProbability(projected, name) {
    const risk = window.ShitHeadPublicRiskV1;
    if (!risk?.calculateHeuristicShitheadProbability) return null;
    try {
      return risk.calculateHeuristicShitheadProbability(projected, {
        temperature: 18,
        burden: {hand: 5, faceUp: 7, faceDown: 10},
        cardQualityWeight: 0.9,
        pickupBase: 8,
        pickupLogWeight: 5,
        futureTurnWeights: [1, 0.3, 0.1],
        viewerId: name,
      });
    } catch {
      return null;
    }
  }

  function strategyRemainingCards(projected) {
    const belief = window.ShitHeadBeliefStateV1;
    if (!belief?.remainingRankCounts) return null;
    const remaining = belief.remainingRankCounts(projected);
    const total = Object.values(remaining).reduce((sum, count) => sum + count, 0);
    return {remaining, total};
  }

  function legalResponseProbability(name, projected) {
    if (projected.phase !== 'play' || projected.currentPlayer !== name) return 0;
    const player = projected.players[name];
    const canPlay = rank => window.ShitHeadRiskV1?.canPlayRank?.(rank, projected) || false;
    const known = Array.isArray(player?.knownHand) ? player.knownHand : [];

    if ((player?.hand?.length || 0) > 0) {
      if (known.some(card => canPlay(card.rank))) return 1;
      const pool = strategyRemainingCards(projected);
      const hidden = Math.max(0, player.hand.length - known.length);
      if (!pool || !hidden || !pool.total) return 0;
      const legal = Object.entries(pool.remaining)
        .filter(([rank]) => canPlay(rank))
        .reduce((sum, [, count]) => sum + count, 0);
      const illegal = Math.max(0, pool.total - legal);
      let noLegal = 1;
      for (let index = 0; index < hidden; index += 1) {
        if (pool.total - index <= 0) break;
        noLegal *= Math.max(0, (illegal - index) / (pool.total - index));
      }
      return Math.max(0, Math.min(1, 1 - noLegal));
    }

    const slots = player?.tableSlots || [];
    if (slots.some(slot => slot.faceUp && canPlay(slot.faceUp.rank))) return 1;
    if (projected.drawPile.length > 0) return 0;
    if (!slots.some(slot => slot.faceDown && !slot.faceUp)) return 0;
    const pool = strategyRemainingCards(projected);
    if (!pool || !pool.total) return 0;
    const legal = Object.entries(pool.remaining)
      .filter(([rank]) => canPlay(rank))
      .reduce((sum, [, count]) => sum + count, 0);
    return Math.max(0, Math.min(1, legal / pool.total));
  }

  function strategyScore(name, candidate, projection, view) {
    const {projected, burned} = projection;
    const probabilities = strategyProbability(projected, name);
    const selfRisk = Number(probabilities?.[name]);
    const next = projected.currentPlayer;
    const nextRisk = next && next !== name ? Number(probabilities?.[next]) : 0;
    const response = next && next !== name ? legalResponseProbability(next, projected) : 0;
    const opponentCards = Object.entries(state.players || {})
      .filter(([id]) => id !== name)
      .map(([, player]) => cardTotal(player));
    const threat = opponentCards.length ? Math.max(0, Math.min(1, (4 - Math.min(...opponentCards)) / 3)) : 0;
    const late = !view.drawCount || cardTotal(state.players[name]) <= 5 || threat > 0;
    const baseline = candidate.refs.length * 9 - strength(candidate.rank);

    if (!Number.isFinite(selfRisk)) return baseline + (burned ? 20 : 0);

    let score = baseline * (late ? 0.35 : 0.75);
    score -= selfRisk * (late ? 1.65 : 0.85);
    score += nextRisk * (late ? 0.55 : 0.12);
    score -= response * (late ? 48 + threat * 35 : 12);

    if (burned) score += (late ? 22 : 8) + Math.min(18, view.pile.length * 1.5);
    if (candidate.rank === '10') {
      // Tens are the ultimate escape/burn card. Keep them unless the pile or
      // an imminent opponent makes spending one materially safer.
      score -= 30;
      if (view.pile.length >= 5 || threat >= 0.67 || cardTotal(projected.players[name]) === 0) score += 48;
    }
    if (candidate.rank === '2') score -= 8;
    if (projected.followUpRank === candidate.rank) score += 10;
    if (projected.phase === 'gameover' || cardTotal(projected.players[name]) === 0) score += 100;
    return score;
  }

  function choose(name, variation = 0) {
    const view = observation(name);
    const groups = new Map();
    const add = (card, zone, index) => {
      if (!card) return;
      if (!groups.has(card.rank)) groups.set(card.rank, []);
      groups.get(card.rank).push({zone,index});
    };
    view.hand.forEach((c,i) => add(c,'hand',i));
    if (!view.drawCount) view.slots.forEach((s,i) => add(s.faceUp,'faceUp',i));
    const plays = [];
    for (const [rank, refs] of groups) {
      for (const candidate of [refs, refs.filter(r => r.zone === 'hand'), refs.filter(r => r.zone === 'faceUp'), [refs[0]]]) {
        if (!candidate.length || !api.validateRefs(name,candidate).ok) continue;
        let tail = 0;
        for (let i=view.pile.length-1;i>=0 && view.pile[i].rank===rank;i--) tail++;
        const burn = rank === '10' || tail+candidate.length >= (rank === '8' ? 3 : 4);
        plays.push({type:'play', rank, refs:candidate, score: candidate.length*9-strength(rank)+(burn ? 24+Math.min(view.pile.length,16):0)});
      }
    }
    if (variation > 1 && variation % 3 === 2 && view.pile.length && !view.followUp) return {type:'pickup'};
    if (plays.length) {
      let options = plays;
      // Show the qualifying opening card, including when READY order broke a tie.
      if (!view.pile.length && !state.burnPile.length && !view.followUp) {
        const lowest = STARTING_RANK_ORDER.find(rank => options.some(p => p.rank === rank));
        if (lowest) options = options.filter(p => p.rank === lowest);
      }
      const remaining = view.hand.length + view.slots.reduce((n,s) => n + !!s.faceUp + !!s.bottom, 0);
      const winning = options.filter(p => !view.drawCount && p.refs.length === remaining);
      if (winning.length) options = winning;
      const unique = [...new Map(options.map(p => [JSON.stringify(p.refs), p])).values()];
      const ranked = unique
        .map(candidate => {
          const projection = projectPlay(name, candidate);
          return {...candidate, strategyScore: strategyScore(name, candidate, projection, view), projection};
        })
        .sort((a, b) => b.strategyScore - a.strategyScore);
      // Only vary among genuinely close decisions. This keeps solo repeatable
      // while still avoiding a deterministic loop in an unusual position.
      const top = ranked[0];
      const close = ranked.filter(candidate => top.strategyScore - candidate.strategyScore < 4);
      const chosen = close[variation % close.length] || top;
      return {type: chosen.type, rank: chosen.rank, refs: chosen.refs};
    }
    if (view.followUp) return {type:'finish'};
    const blind = view.slots.map((_,i)=>i).filter(i=>api.canBlind(name,i));
    if (blind.length) return {type:'blind',index:blind[Math.floor(Math.random()*blind.length)]};
    for (const refs of groups.values()) {
      const up = refs.filter(r=>r.zone==='faceUp');
      if (api.canPickupTableRefs(name,up)) return {type:'table-pickup',refs:up};
    }
    return {type:'pickup'};
  }
  function step(name = state.currentPlayer) {
    if (state.phase !== 'play' || name !== state.currentPlayer) return;
    // Repeated public positions can otherwise make deterministic opponents loop.
    // Explore another legal play when this CPU sees the same position again.
    const key = name + JSON.stringify(observation(name));
    const repeats = visited.get(key) || 0;
    visited.set(key, repeats + 1);
    if (visited.size > 200) visited.delete(visited.keys().next().value);
    const action = choose(name, repeats);
    if (action.type==='play') api.playRefs(name,action.refs);
    else if (action.type==='blind') api.playFaceDown(name,action.index);
    else if (action.type==='table-pickup') api.pickupTableAndDiscard(name,action.refs);
    else if (action.type==='finish') finishTurn(name);
    else pickupDiscard(name);
  }
  function schedule() {
    clearTimeout(timer); timer = null;
    if (!active || paused || writing || document.hidden || document.querySelector('dialog[open]') || state.phase !== 'play' || state.currentPlayer === state.viewer) return;
    timer = setTimeout(() => { timer=null; if(active && !paused && !document.hidden && !document.querySelector('dialog[open]')) step(); }, 950);
  }
  const previousRender = render;
  render = function renderSolo() {
    previousRender();
    if (!active) return;
    viewerSelect.disabled = true;
    const hint = playerSeat.querySelector('.setup-hint');
    if (hint && !state.setupReady[state.viewer]) hint.textContent = 'Swap a hand card with a face-up card, then press READY.';
    for (const [element,name] of [[opponentLeft,seatingForViewer().left],[opponentRight,seatingForViewer().right]]) {
      let label = element.querySelector('.cpu-label');
      if (!label) { label=document.createElement('span'); label.className='cpu-label'; element.append(label); }
      const notepadName = document.querySelector(`.player-notepad[data-player="${name}"] .notepad-name`);
      if (notepadName) notepadName.textContent = publicName(name) + ' · CPU';
      label.textContent = `CPU${state.phase==='play' && state.currentPlayer===name ? ' · thinking…' : ''}`;
    }
    save(); schedule();
  };
  button.onclick = () => {
    paused=true; clearTimeout(timer); save();
    const saved=read(); dialog.querySelector('#soloResume').hidden=!valid(saved);
    info.textContent = valid(saved) ? `Saved ${new Date(saved.savedAt).toLocaleString()}. A new solo game replaces this save.` : 'Your game will save automatically after every move.';
    dialog.showModal();
  };
  dialog.querySelector('#soloNew').onclick=fresh;
  dialog.querySelector('#soloResume').onclick=resume;
  dialog.querySelector('#soloClose').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{paused=false;schedule();});
  document.addEventListener('close', schedule, true);
  document.addEventListener('visibilitychange',()=>{save();schedule();});
  window.addEventListener('pagehide',save);
  themeSelect.addEventListener('change',save);
  newGameBtn.addEventListener('click',()=>{
    if (!active || writing) return;
    visited.clear();
    arrangeCPUs(); render();
  });
  // Stop before a network room mutates the local game; its save remains resumable.
  document.addEventListener('click',e=>{if(active && e.target.closest('#mpCreate,#mpJoin')) { stop(); state.scores=Object.fromEntries(PLAYER_NAMES.map(n=>[n,0])); state.roundScored=false; }},true);
  window.ShitHeadSolo = {choose, step, stop, get active(){return active;}};
  try { if(localStorage.getItem(ACTIVE)==='1' && valid(read())) resume(); } catch {}

  async function prepareOffline() {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) { status.textContent='Offline preparation unavailable'; return; }
    try {
      const reg = await navigator.serviceWorker.register('./sw.js', {scope:'./',updateViaCache:'none'});
      await navigator.serviceWorker.ready;
      const worker = reg.active;
      const channel = new MessageChannel();
      channel.port1.onmessage=e=>{ status.textContent=e.data.ready ? 'Ready for offline play' : 'Reconnect to finish offline setup'; channel.port1.close(); };
      worker.postMessage({type:'CHECK_READY'},[channel.port2]);
    } catch { status.textContent='Reconnect to prepare offline play'; }
  }
  prepareOffline();
})();
