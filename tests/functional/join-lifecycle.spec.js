const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
const fake=fs.readFileSync('tests/functional/fake-peer.js','utf8')+`
(() => {const Base=window.Peer;window.__testPeers=[];window.Peer=class extends Base {
  constructor(...args){super(...args);window.__testPeers.push(this);}
};})();
`;
async function prepare(browser) {
 const context=await browser.newContext();
 await context.route('https://unpkg.com/**',r=>r.fulfill({contentType:'application/javascript',body:fake}));
 const host=await context.newPage(),guest=await context.newPage();
 for(const page of [host,guest]) {
   await page.goto('/index.html');
   await page.waitForFunction(()=>!!window.ShitHeadMultiplayer);
 }
 await host.locator('.multiplayer-trigger').click();
 await host.locator('#mpDisplayName').fill('Host');
 await host.locator('#mpCreate').click();
 await host.waitForFunction(()=>window.ShitHeadMultiplayer.status.roomReady);
 const code=await host.locator('#mpRoomDisplay').textContent();
 await guest.locator('.multiplayer-trigger').click();
 await guest.locator('#mpDisplayName').fill('Guest');
 await guest.locator('#mpRoomCode').fill(code);
 return {context,host,guest};
}
test('a guest can leave and retry without its old close or data callbacks cancelling the new join',async({browser})=>{
 const {context,host,guest}=await prepare(browser);
 const errors=[];guest.on('pageerror',e=>errors.push(e.message));
 await guest.locator('#mpJoin').click();
 await guest.waitForFunction(()=>window.ShitHeadMultiplayer.status.connectionState==='connected');
 await guest.evaluate(()=>{
   const peer=window.__testPeers.at(-1);
   window.__oldPeer=peer;window.__oldConnection=[...peer.connections.values()][0];
   window.ShitHeadMultiplayer.disconnect();
 });
 await expect(guest.locator('#mpError')).toHaveText('');
 await guest.locator('.multiplayer-trigger').click();
 // Wait until host has observed the deliberate departure before trying again.
 await host.waitForFunction(()=>window.ShitHeadMultiplayer.status.players.length===1);
 await guest.locator('#mpJoin').click();
 await guest.evaluate(()=>{
   window.__oldConnection.emit('close');
   window.__oldPeer.emit('error',{type:'peer-unavailable'});
   window.__oldConnection.emit('data',{type:'rejected',message:'Stale rejection'});
 });
 await guest.waitForFunction(()=>window.ShitHeadMultiplayer.status.connectionState==='connected');
 await expect(guest.locator('#mpError')).toHaveText('');
 await expect.poll(()=>host.evaluate(()=>window.ShitHeadMultiplayer.status.players.length)).toBe(2);
 expect(errors).toEqual([]);
 await context.close();
});
test('a rejected seat keeps the real reason, then Any open seat can join successfully',async({browser})=>{
 const {context,host,guest}=await prepare(browser);
 await guest.locator('.multiplayer-advanced summary').click();
 await guest.locator('#mpPlayer').selectOption('Oliver');
 await guest.locator('#mpJoin').click();
 await expect(guest.locator('#mpError')).toContainText('That seat is already connected');
 await expect(guest.locator('#mpError')).not.toContainText('host was lost');
 await guest.locator('#mpPlayer').selectOption('');
 await guest.locator('#mpJoin').click();
 await guest.waitForFunction(()=>window.ShitHeadMultiplayer.status.connectionState==='connected');
 await expect(guest.locator('#mpError')).toHaveText('');
 await expect.poll(()=>host.evaluate(()=>window.ShitHeadMultiplayer.status.players.length)).toBe(2);
 await context.close();
});
test('an initial connection close is distinguished from losing an established game',async({browser})=>{
 const {context,guest}=await prepare(browser);
 await guest.evaluate(()=>{
   const Base=window.Peer;
   window.Peer=class extends Base {
     connect(...args){const conn=super.connect(...args);setTimeout(()=>conn.emit('close'),0);return conn;}
   };
 });
 await guest.locator('#mpJoin').click();
 await expect(guest.locator('#mpError')).toContainText('Could not connect to the host');
 await expect(guest.locator('#mpJoin')).toBeVisible();
 await context.close();
});

async function startWithGuest(host,guest) {
 await guest.locator('#mpJoin').click();
 await guest.waitForFunction(()=>window.ShitHeadMultiplayer.status.connectionState==='connected');
 await host.evaluate(()=>window.ShitHeadMultiplayer.startGame());
 await guest.waitForFunction(()=>state.phase==='setup');
 await host.evaluate(()=>{
   state.scores.Dan=7;
   state.phase='play';
   state.currentPlayer='Dan';
   window.ShitHeadMultiplayer.publishState();
 });
 await guest.waitForFunction(()=>state.phase==='play' && state.scores.Dan===7);
 return host.evaluate(()=>JSON.stringify({players:state.players,scores:state.scores,currentPlayer:state.currentPlayer}));
}
async function expectSameGame(host,guest,signature) {
 await guest.waitForFunction(()=>window.ShitHeadMultiplayer.status.connectionState==='connected');
 expect(await guest.evaluate(()=>state.viewer)).toBe('Dan');
 expect(await guest.evaluate(()=>JSON.stringify({players:state.players,scores:state.scores,currentPlayer:state.currentPlayer}))).toBe(signature);
 expect(await host.evaluate(()=>JSON.stringify({players:state.players,scores:state.scores,currentPlayer:state.currentPlayer}))).toBe(signature);
 expect(await host.evaluate(()=>window.ShitHeadMultiplayer.status.players)).toEqual(['Oliver','Dan']);
}

test('refreshing an invite restores a PIN even with a remembered display name',async({browser})=>{
 const {context,host,guest}=await prepare(browser);
 const signature=await startWithGuest(host,guest);
 const code=await host.locator('#mpRoomDisplay').textContent();
 const pin=await guest.locator('#mpRejoinPin').inputValue();
 // Navigation intentionally leaves a stale host-side connection in the fake transport.
 await guest.goto(`/index.html?room=${code}`);
 await expect(guest.locator('#mpDisplayName')).toHaveValue('Guest');
 await expect(guest.locator('#mpRejoinPin')).toHaveValue(pin);
 await guest.locator('#mpJoin').click();
 await expectSameGame(host,guest,signature);
 await context.close();
});

test('entering a room code restores the matching saved seat after closing its tab',async({browser})=>{
 const {context,host,guest}=await prepare(browser);
 const signature=await startWithGuest(host,guest);
 const code=await host.locator('#mpRoomDisplay').textContent();
 await guest.close();
 const replacement=await context.newPage();
 await replacement.goto('/index.html');
 await replacement.locator('.multiplayer-trigger').click();
 await replacement.locator('#mpRoomCode').fill(code);
 await replacement.locator('#mpJoin').click();
 await expectSameGame(host,replacement,signature);
 await context.close();
});

test('valid PIN replaces a stale live channel and ignores all of its late callbacks',async({browser})=>{
 const {context,host,guest}=await prepare(browser);
 const signature=await startWithGuest(host,guest);
 const code=await host.locator('#mpRoomDisplay').textContent();
 const pin=await guest.locator('#mpRejoinPin').inputValue();
 await host.evaluate(()=>{window.__retired=[...window.__testPeers.at(-1).connections.values()][0];});
 const replacement=await context.newPage();
 await replacement.goto(`/index.html?room=${code}&pin=${pin}`);
 await replacement.locator('#mpJoin').click();
 await expectSameGame(host,replacement,signature);
 await host.evaluate(()=>{
   window.__retired.emit('close');
   window.__retired.emit('error',new Error('late channel error'));
   window.__retired.emit('data',{type:'join',player:'Chris',displayName:'Stale'});
   window.__retired.emit('data',{type:'action',player:'Dan',action:{type:'pickup'}});
 });
 await expectSameGame(host,replacement,signature);
 // Do not require the notification to beat the transport's close event.
 await guest.waitForFunction(()=>window.ShitHeadMultiplayer.status.role==='local');
 await expect(guest.locator('#mpJoin')).toBeVisible();
 await context.close();
});

test('a changed display name cannot silently use another player saved PIN',async({browser})=>{
 const {context,host,guest}=await prepare(browser);
 await startWithGuest(host,guest);
 const code=await host.locator('#mpRoomDisplay').textContent();
 const newcomer=await context.newPage();
 await newcomer.goto(`/index.html?room=${code}`);
 await newcomer.locator('#mpDisplayName').fill('New player');
 await newcomer.locator('#mpJoin').click();
 await expect(newcomer.locator('#mpError')).toContainText('The game has started');
 expect(await host.evaluate(()=>window.ShitHeadMultiplayer.status.players.length)).toBe(2);
 await context.close();
});

test('an incorrect PIN is rejected instead of allocating a different seat',async({browser})=>{
 const {context,host,guest}=await prepare(browser);
 await guest.locator('.multiplayer-advanced summary').click();
 await guest.locator('#mpRejoinPin').fill('BADPINXX');
 await guest.locator('#mpJoin').click();
 await expect(guest.locator('#mpError')).toContainText('PIN does not match this room');
 expect(await host.evaluate(()=>window.ShitHeadMultiplayer.status.players.length)).toBe(1);
 await context.close();
});

test('switching rooms clears the previous room PIN',async({browser})=>{
 const {context,host,guest}=await prepare(browser);
 await guest.locator('#mpJoin').click();
 await guest.waitForFunction(()=>window.ShitHeadMultiplayer.status.connectionState==='connected');
 const otherHost=await context.newPage();
 await otherHost.goto('/index.html');
 await otherHost.locator('.multiplayer-trigger').click();
 await otherHost.locator('#mpDisplayName').fill('Other host');
 await otherHost.locator('#mpCreate').click();
 await otherHost.waitForFunction(()=>window.ShitHeadMultiplayer.status.roomReady);
 const otherCode=await otherHost.locator('#mpRoomDisplay').textContent();
 await guest.evaluate(()=>window.ShitHeadMultiplayer.disconnect());
 await guest.locator('.multiplayer-trigger').click();
 await guest.locator('#mpRoomCode').fill(otherCode);
 await expect(guest.locator('#mpRejoinPin')).toHaveValue('');
 await guest.locator('#mpJoin').click();
 await guest.waitForFunction(()=>window.ShitHeadMultiplayer.status.connectionState==='connected');
 expect(await otherHost.evaluate(()=>window.ShitHeadMultiplayer.status.players.length)).toBe(2);
 await context.close();
});

