const {test, expect} = require('@playwright/test');
const fs = require('node:fs');
const fake = fs.readFileSync('tests/functional/fake-peer.js','utf8') + 
'const BasePeer = window.Peer; window.__peers=[]; window.Peer=class extends BasePeer {constructor(...args){super(...args);window.__peers.push(this);}};';
async function prepare(browser, oldHost=false) {
  const context=await browser.newContext();
  await context.route('https://unpkg.com/**',r=>r.fulfill({contentType:'application/javascript',body:fake}));
  const host=await context.newPage(), guest=await context.newPage();
  for(const p of [host,guest]) {await p.goto('/index.html');await p.waitForFunction(()=>!!window.ShitHeadMultiplayer);}
  if(oldHost) await host.evaluate(()=>{
    const Base=window.Peer;
    window.Peer=class extends Base {
      emit(type,...args) {
        if(type==='connection') {
          const conn=args[0], send=conn.send.bind(conn);
          conn.send=data=>{if(data.type==='welcome'){data={...data};delete data.healthChecks;}send(data);};
        }
        return super.emit(type,...args);
      }
    };
  });
  await host.locator('.multiplayer-trigger').click();
  await host.locator('#mpDisplayName').fill('Host');
  await host.locator('#mpCreate').click();
  await host.waitForFunction(()=>window.ShitHeadMultiplayer.status.roomReady);
  await guest.locator('.multiplayer-trigger').click();
  await guest.locator('#mpDisplayName').fill('Guest');
  await guest.locator('#mpRoomCode').fill(await host.locator('#mpRoomDisplay').textContent());
  await guest.locator('#mpJoin').click();
  await guest.waitForFunction(()=>window.ShitHeadMultiplayer.status.connectionState==='connected');
  await host.evaluate(()=>{
    window.ShitHeadMultiplayer.startGame();
    state.phase='play';state.currentPlayer='Dan';state.scores.Dan=7;
    render();window.ShitHeadMultiplayer.publishState();
    const conn=[...window.__peers.at(-1).connections.values()][0];
    window.__guestChannel=conn;
    const send=conn.send.bind(conn);
    conn.send=data=>{if(!conn.dropPackets)send(data);};
  });
  await guest.waitForFunction(()=>state.phase==='play' && state.scores.Dan===7);
  return {context,host,guest};
}
const signature=p=>p.evaluate(()=>JSON.stringify({players:state.players,scores:state.scores,turn:state.currentPlayer}));

test('silent channel stalls expose Reconnect and preserve cards, scores, turn and PIN',async({browser})=>{
  const {context,host,guest}=await prepare(browser);
  const before=await signature(host), pin=await guest.locator('#mpRejoinPin').inputValue();
  await guest.clock.install();
  await host.evaluate(()=>{window.__guestChannel.dropPackets=true;});
  await guest.clock.fastForward(25000);
  await guest.waitForFunction(()=>window.ShitHeadMultiplayer.status.connectionState==='stalled');
  await expect(guest.locator('#mpReconnect')).toBeVisible();
  await expect(guest.locator('#mpReconnect')).toBeEnabled();
  expect(await guest.evaluate(()=>window.ShitHeadMultiplayer.sendAction({type:'pickup'}))).toBe(false);
  await guest.locator('#mpReconnect').click();
  await guest.waitForFunction(()=>window.ShitHeadMultiplayer.status.connectionState==='connected');
  expect(await signature(guest)).toBe(before);
  expect(await signature(host)).toBe(before);
  await expect(guest.locator('#mpRejoinPin')).toHaveValue(pin);
  expect(await host.evaluate(()=>window.ShitHeadMultiplayer.status.players)).toEqual(['Oliver','Dan']);
  await context.close();
});

test('resuming a silent channel resynchronises the table before enabling play',async({browser})=>{
  const {context,host,guest}=await prepare(browser);
  await guest.clock.install();
  await host.evaluate(()=>{window.__guestChannel.dropPackets=true;state.scores.Dan=9;});
  await guest.clock.fastForward(25000);
  await guest.waitForFunction(()=>window.ShitHeadMultiplayer.status.connectionState==='stalled');
  await host.evaluate(()=>{window.__guestChannel.dropPackets=false;});
  await guest.clock.fastForward(5000);
  await guest.waitForFunction(()=>window.ShitHeadMultiplayer.status.connectionState==='connected' && state.scores.Dan===9);
  expect(await signature(guest)).toBe(await signature(host));
  await context.close();
});

test('returning from a suspended tab allows a fresh heartbeat response',async({browser})=>{
  const {context,guest}=await prepare(browser);
  await guest.clock.install();
  await guest.evaluate(()=>Object.defineProperty(document,'hidden',{configurable:true,get:()=>true}));
  await guest.clock.fastForward(120000);
  expect(await guest.evaluate(()=>window.ShitHeadMultiplayer.status.connectionState)).toBe('connected');
  await guest.evaluate(()=>{
    Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await guest.clock.fastForward(5000);
  expect(await guest.evaluate(()=>window.ShitHeadMultiplayer.status.connectionState)).toBe('connected');
  await context.close();
});

test('older hosts retain manual reconnect without unsupported heartbeat timeouts',async({browser})=>{
  const {context,guest}=await prepare(browser,true);
  await guest.clock.install();
  await guest.clock.fastForward(60000);
  expect(await guest.evaluate(()=>window.ShitHeadMultiplayer.status.connectionState)).toBe('connected');
  await guest.locator('.multiplayer-trigger').click();
  await expect(guest.locator('#mpReconnect')).toBeVisible();
  await guest.locator('#mpReconnect').click();
  await guest.waitForFunction(()=>window.ShitHeadMultiplayer.status.connectionState==='connected');
  await context.close();
});

test('a failed guest channel does not mark healthy host signalling unavailable',async({browser})=>{
  const {context,host}=await prepare(browser);
  await host.evaluate(()=>{
    const peer=window.__peers.at(-1);
    peer.open=true;peer.disconnected=false;
    peer.emit('error',{type:'webrtc',message:'One channel failed'});
  });
  expect(await host.evaluate(()=>window.ShitHeadMultiplayer.status.roomReady)).toBe(true);
  await expect(host.locator('#mpError')).toHaveText('');
  await context.close();
});

test('timeouts identify the failed connection stage',async({browser})=>{
  for(const stage of ['service','channel','welcome']) {
    const context=await browser.newContext();
    await context.route('https://unpkg.com/**',r=>r.fulfill({contentType:'application/javascript',body:fake}));
    const page=await context.newPage();
    await page.goto('/index.html');
    await page.waitForFunction(()=>!!window.ShitHeadMultiplayer);
    await page.evaluate(stage=>{
      const Base=window.Peer;
      window.Peer=class extends Base {
        on(type,callback){if(stage==='service' && type==='open')return this;return super.on(type,callback);}
        connect(id){
          const conn=super.connect(id);
          if(stage==='welcome')setTimeout(()=>{conn.open=true;conn.emit('open');},0);
          return conn;
        }
      };
    },stage);
    await page.clock.install();
    await page.locator('.multiplayer-trigger').click();
    await page.locator('#mpRoomCode').fill('ABC234');
    await page.locator('#mpJoin').click();
    await page.clock.runFor(100);
    await page.clock.fastForward(21000);
    const expected={service:'Could not reach the connection service',channel:'Could not establish a connection to the host',welcome:'Connected to the host, but the game did not reply'};
    await expect(page.locator('#mpError')).toContainText(expected[stage]);
    await expect(page.locator('#mpJoin')).toBeVisible();
    await context.close();
  }
});

test('a late setup snapshot cannot queue a second proposal that undoes a swap',async({browser})=>{
  const {context,host,guest}=await prepare(browser);
  await host.evaluate(()=>{
    state.phase='setup';
    state.setupReady={Oliver:false,Dan:false};
    state.setupReadyOrder=[];
    state.setupSelection=null;
    render();
    window.ShitHeadMultiplayer.publishState();
  });
  await guest.waitForFunction(()=>state.phase==='setup');
  const old=await host.evaluate(()=>JSON.parse(JSON.stringify(state)));
  const wanted=old.players.Dan.hand[0];
  await host.evaluate(()=>{
    const conn=window.__guestChannel,send=conn.send.bind(conn);
    conn.send=data=>{if(data.type!=='state')send(data);};
  });
  await guest.evaluate(old=>{
    selectSetupCard('Dan','hand',0);
    selectSetupCard('Dan','table',0);
    const conn=[...window.__peers.at(-1).connections.values()][0];
    conn.emit('data',{type:'state',state:old});
  },old);
  // Allow the obsolete 40ms render-publication timer to fire if it still exists.
  await guest.waitForTimeout(150);
  expect(await host.evaluate(()=>state.players.Dan.faceUp[0])).toEqual(wanted);
  await context.close();
});
