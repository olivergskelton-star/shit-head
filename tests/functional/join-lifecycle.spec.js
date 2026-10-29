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
