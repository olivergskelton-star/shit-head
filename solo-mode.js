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
        plays.push({type:'play', refs:candidate, score: candidate.length*9-strength(rank)+(burn ? 24+Math.min(view.pile.length,16):0)});
      }
    }
    if (variation > 1 && variation % 3 === 2 && view.pile.length && !view.followUp) return {type:'pickup'};
    if (plays.length) {
      const unique = [...new Map(plays.map(p => [JSON.stringify(p.refs), p])).values()].sort((a,b)=>b.score-a.score);
      return unique[variation % unique.length];
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
