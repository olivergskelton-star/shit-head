const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
const path=require('node:path');
const fakePeer=fs.readFileSync(path.join(__dirname,'fake-peer.js'),'utf8');
test.beforeEach(async({page})=>{
  await page.route('https://unpkg.com/**',r=>r.fulfill({contentType:'application/javascript',body:fakePeer}));
});
test('solo starts, CPUs play, all assets survive offline reload and save resumes',async({page,context})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/index.html');
  await page.locator('#soloPlay').click();
  await page.locator('#soloNew').click();
  await expect(page.locator('.cpu-label')).toHaveCount(3);
  expect(await page.evaluate(()=>state.setupReady.Dan && state.setupReady.Chris && state.setupReady['CPU 3'])).toBe(true);
  await expect(page.locator('#offlineStatus')).toHaveText('Ready for offline play',{timeout:30000});
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await page.screenshot({path:'/tmp/solo-desktop.png'});
  await page.setViewportSize({width:393,height:852});
  await page.screenshot({path:'/tmp/solo-mobile.png'});
  await expect(page.locator('.setup-ready')).toBeInViewport();
  await page.setViewportSize({width:1280,height:900});
  const before=await page.evaluate(()=>JSON.stringify(state.players));
  await context.setOffline(true);
  await page.reload({waitUntil:'load'});
  expect(await page.evaluate(()=>JSON.stringify(state.players))).toBe(before);
  await expect(page.locator('#soloPlay')).toHaveText('Solo · pause');
  await page.locator('.setup-ready').click();
  await page.evaluate(()=>{ state.currentPlayer='Dan'; render(); });
  await page.waitForFunction(()=>state.discard.length+state.burnPile.length>0);
  expect(await page.evaluate(()=>state.phase)).toBe('play');
  await page.locator('#soloPlay').click();
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('shithead-solo-v1')));
  expect(saved.state.phase).toBe('play');
  await page.reload({waitUntil:'load'});
  expect(await page.evaluate(()=>window.ShitHeadSolo.active)).toBe(true);
  await expect(page.locator('#offlineStatus')).toHaveText('Ready for offline play');
  expect(await page.evaluate(()=>[...document.images].filter(i=>!i.complete || i.naturalWidth===0).map(i=>i.src))).toEqual([]);
  expect(errors).toEqual([]);
});
test('CPU policy completes 5 rounds with 52 unique cards conserved and scores once',async({page})=>{
  test.setTimeout(120000);
  await page.goto('/index.html');
  await page.locator('#soloPlay').click();await page.locator('#soloNew').click();
  const result=await page.evaluate(()=>{
    let moves=0;
    for(let round=0;round<5;round++){
      console.log('CPU round '+round);
      if(round) newGameBtn.click();
      markSetupReady(state.viewer);
      for(let n=0;state.phase==='play' && n<3000;n++){
        window.ShitHeadSolo.step(state.currentPlayer);moves++;
        const cards=[...state.drawPile,...state.discard,...state.burnPile,...PLAYER_NAMES.flatMap(name=>[...state.players[name].hand,...state.players[name].tableSlots.flatMap(s=>[s.faceUp,s.faceDown]).filter(Boolean)])];
        if(cards.length!==52 || new Set(cards.map(cardText)).size!==52) throw Error('Card conservation');
      }
      if(state.phase!=='gameover') throw Error('Round stalled '+round);
      const sum=Object.values(state.scores).reduce((a,b)=>a+b,0);
      if(sum!==round+1) throw Error('Score counted incorrectly');
      render();
      if(Object.values(state.scores).reduce((a,b)=>a+b,0)!==sum) throw Error('Score counted twice');
    }
    return moves;
  });
  expect(result).toBeGreaterThan(100);
});
test('solo save survives switching to an online lobby',async({page})=>{
  await page.goto('/index.html');await page.waitForFunction(()=>!!window.ShitHeadMultiplayer);
  await page.locator('#soloPlay').click();await page.locator('#soloNew').click();
  const original=await page.evaluate(()=>JSON.stringify(state.players));
  await page.locator('.multiplayer-trigger').click();await page.locator('#mpCreate').click();
  expect(await page.evaluate(()=>window.ShitHeadSolo.active)).toBe(false);
  expect(await page.evaluate(()=>state.phase)).toBe('lobby');
  await page.locator('.room-lobby-close').click();
  await page.locator('#soloPlay').click();await page.locator('#soloResume').click();
  expect(await page.evaluate(()=>JSON.stringify(state.players))).toBe(original);
  expect(await page.evaluate(()=>window.ShitHeadMultiplayer.status.role)).toBe('local');
});
