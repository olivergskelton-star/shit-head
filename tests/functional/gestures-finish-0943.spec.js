const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
test.use({hasTouch:true,viewport:{width:390,height:844}});
test.beforeEach(async({page})=>{
  await page.route('https://unpkg.com/**',r=>r.fulfill({contentType:'application/javascript',body:fs.readFileSync('tests/functional/fake-peer.js','utf8')}));
  await page.goto('/index.html');
  await page.waitForFunction(()=>!!window.ShitHeadMultiplayer && !!window.ShitHeadSolo);
  await page.locator('#soloPlay').click();await page.locator('#soloNew').click();
});
async function position(page,{hands,pile=[],current=0,solo=false}){
  await page.evaluate(({hands,pile,current,solo})=>{
    if(!solo)window.ShitHeadSolo.stop();
    const cards=[...state.drawPile,...state.discard,...state.burnPile];
    for(const name of PLAYER_NAMES){const p=state.players[name];cards.push(...p.hand,...(p.tableSlots?p.tableSlots.flatMap(s=>[s.faceUp,s.faceDown]).filter(Boolean):[...p.faceUp,...p.faceDown]));}
    const take=id=>{const i=cards.findIndex(c=>cardText(c)===id);if(i<0)throw Error('Missing '+id);return cards.splice(i,1)[0];};
    PLAYER_NAMES.forEach((n,i)=>{Object.assign(state.players[n],{hand:hands[i].map(take),faceUp:[],faceDown:[],tableSlots:[0,1,2].map(()=>({faceUp:null,faceDown:null}))});});
    state.discard=pile.map(take);state.drawPile=[];state.burnPile=cards;
    state.phase='play';state.currentPlayer=PLAYER_NAMES[current];state.followUpRank=null;
    state.selected=[];state.selectedRefs=[];state.selectedZone=null;state.roundScored=false;state.shitHead=null;
    state.finishOrder=PLAYER_NAMES.filter((n,i)=>!hands[i].length);state.scores=Object.fromEntries(PLAYER_NAMES.map(n=>[n,0]));render();
  },{hands,pile,current,solo});
}
async function swipe(page,selector,dx,dy){
  const el=page.locator(selector).first();await el.scrollIntoViewIfNeeded();
  const box=await el.boundingBox();const x=box.x+box.width/2,y=box.y+box.height/2;
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
  for(const amount of [.2,.5,1])await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx*amount,y:y+dy*amount}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
}
async function conserved(page){expect(await page.evaluate(()=>{
 const cards=[...state.drawPile,...state.discard,...state.burnPile,...PLAYER_NAMES.flatMap(n=>[...state.players[n].hand,...state.players[n].tableSlots.flatMap(s=>[s.faceUp,s.faceDown]).filter(Boolean)])];
 return [cards.length,new Set(cards.map(cardText)).size];
})).toEqual([52,52]);}

test('real touch gestures play a single card and groups, pick up, and reject illegal or out-of-turn moves',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const hands=[['4♣','4♦','9♠'],['5♣'],['6♣'],['7♣']];
 await position(page,{hands});
 await swipe(page,'.hand button.card',0,-65);
 expect(await page.evaluate(()=>state.players[state.viewer].hand.length)).toBe(2);
 expect(await page.evaluate(()=>state.discard.map(cardText))).toEqual(['4♣']);await conserved(page);
 await position(page,{hands});
 await page.locator('.hand button.card').nth(0).tap();
 await expect(page.locator('.hand button.card.selected')).toHaveCount(1);
 await page.locator('.hand button.card').nth(1).tap();
 await expect(page.locator('.hand button.card.selected')).toHaveCount(2);
 await swipe(page,'.hand button.card.selected',0,-65);
 expect(await page.evaluate(()=>state.discard.map(cardText))).toEqual(['4♣','4♦']);await conserved(page);
 await position(page,{hands,pile:['A♣']});
 await swipe(page,'.hand button.card',0,-65);
 expect(await page.evaluate(()=>state.discard.map(cardText))).toEqual(['A♣']);
 await swipe(page,'#discardPile',0,65);
 expect(await page.evaluate(()=>state.discard.length)).toBe(0);
 expect(await page.evaluate(()=>state.players[state.viewer].hand.length)).toBe(4);await conserved(page);
 await position(page,{hands,pile:['A♣'],current:1});
 await swipe(page,'#discardPile',0,65);
 expect(await page.evaluate(()=>state.discard.map(cardText))).toEqual(['A♣']);
 await position(page,{hands});
 await swipe(page,'.hand button.card',65,0);
 expect(await page.evaluate(()=>state.discard.length)).toBe(0);
 await expect(page.locator('#soloFinishRound')).toBeHidden();
 expect(errors).toEqual([]);
});

test('Finish round is available only once the solo human is out and settles one real score',async({page})=>{
 await expect(page.locator('#soloFinishRound')).toBeHidden();
 await position(page,{hands:[[],['10♠'],['4♣'],[]],pile:['6♦'],current:1,solo:true});
 await expect(page.locator('#soloFinishRound')).toBeVisible();
 await page.locator('#soloFinishRound').click();
 await expect(page.locator('#roundOverDialog')).toBeVisible();
 expect(await page.evaluate(()=>state.shitHead)).toBe('Chris');
 expect(await page.evaluate(()=>Object.values(state.scores).reduce((a,b)=>a+b,0))).toBe(1);
 expect(await page.evaluate(()=>window.ShitHeadSolo.finishing)).toBe(false);await conserved(page);
 await page.locator('#roundNewDeal').click();await expect(page.locator('.setup-ready')).toBeVisible();
 await expect(page.locator('#soloFinishRound')).toBeHidden();
 expect(await page.evaluate(()=>state.scores.Chris)).toBe(1);
});

test('touch flicks support face-up and exposed blind table cards',async({page})=>{
 for(const zone of ['faceUp','faceDown']){
  await position(page,{hands:[[],['5♣'],['6♣'],['7♣']]});
  await page.evaluate(zone=>{
   const i=state.burnPile.findIndex(c=>cardText(c)==='4♣');
   state.players[state.viewer].tableSlots[0][zone]=state.burnPile.splice(i,1)[0];
   state.finishOrder=[];render();
  },zone);
  await swipe(page,'.self-face-row button.card',0,-65);
  expect(await page.evaluate(()=>state.discard.map(cardText))).toEqual(['4♣']);
  expect(await page.evaluate(()=>window.ShitHeadTablePlay.isOut(state.viewer))).toBe(true);
  await conserved(page);
 }
});
