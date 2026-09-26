const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const fakePeerSource = fs.readFileSync(path.join(__dirname, 'fake-peer.js'), 'utf8');

async function load(page) {
  await page.goto('/index.html');
  await page.waitForFunction(() => !!window.ShitHeadMultiplayer);
}

async function createRoom(page) {
  await page.locator('.multiplayer-trigger').click();
  await page.locator('#mpDisplayName').fill('Alex');
  await page.locator('.multiplayer-advanced summary').click();
  await page.locator('#mpPlayer').selectOption('Oliver');
  await page.locator('#mpCreate').click();
  await expect(page.locator('#mpRoomDisplay')).not.toHaveText('');
  return (await page.locator('#mpRoomDisplay').textContent()).trim();
}

async function joinRoom(page, roomCode, seat, displayName, invite = null) {
  if (invite) {
    await page.goto(invite);
    await expect(page.locator('.multiplayer-dialog')).toBeVisible();
    await expect(page.locator('#mpRoomCode')).toHaveValue(roomCode);
  } else await page.locator('.multiplayer-trigger').click();
  await page.locator('#mpDisplayName').fill(displayName);
  await page.locator('.multiplayer-advanced summary').click();
  await page.locator('#mpPlayer').selectOption(seat);
  await page.locator('#mpRoomCode').fill(roomCode);
  await page.locator('#mpJoin').click();
  await page.waitForFunction((expected) => (
    window.ShitHeadMultiplayer?.status?.role === 'client'
    && window.ShitHeadMultiplayer?.status?.player === expected
  ), seat);
}

test('four humans occupy all seats, scores survive a seat rejoin, and solo has three CPUs', async ({ browser }) => {
  const context = await browser.newContext();
  await context.route('https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: fakePeerSource });
  });

  const host = await context.newPage();
  const dan = await context.newPage();
  const chris = await context.newPage();
  const fourth = await context.newPage();
  const pages = [host, dan, chris, fourth];
  await Promise.all(pages.map(load));

  const roomCode = await createRoom(host);
  const invite = await host.locator('#mpInviteLink').inputValue();
  expect(new URL(invite).searchParams.get('room')).toBe(roomCode);
  expect(new URL(invite).searchParams.has('pin')).toBe(false);
  await joinRoom(dan, roomCode, 'Dan', 'Beth');
  await joinRoom(chris, roomCode, 'Chris', 'Cass');
  await joinRoom(fourth, roomCode, 'Player 4', 'Dee', invite);

  await expect(host.locator('#mpPlayers .room-player.connected')).toHaveCount(4);
  await expect(host.locator('.room-lobby-primary')).toHaveText('START GAME · 4 PLAYERS');
  await host.locator('.room-lobby-primary').click();
  await Promise.all(pages.map((page) => page.waitForFunction(() => state.phase === 'setup')));

  expect(await host.evaluate(() => PLAYER_NAMES)).toEqual(['Oliver', 'Dan', 'Chris', 'Player 4']);
  await expect(host.locator('#opponentLeft')).toBeVisible();
  await expect(host.locator('#opponentTop')).toBeVisible();
  await expect(host.locator('#opponentRight')).toBeVisible();
  const tableGeometry = await host.evaluate(() => ({
    top: document.querySelector('#opponentTop .face-row').getBoundingClientRect().toJSON(),
    center: document.querySelector('.centre-zone').getBoundingClientRect().toJSON(),
    own: document.querySelector('.self-table-zone').getBoundingClientRect().toJSON(),
  }));
  expect(tableGeometry.top.bottom).toBeLessThan(tableGeometry.center.top);
  expect(tableGeometry.center.bottom).toBeLessThan(tableGeometry.own.top);

  for (const page of pages) {
    await page.evaluate(() => {
      markSetupReady(state.viewer);
      window.ShitHeadMultiplayer.publishState();
    });
    await host.waitForFunction((player) => state.setupReady?.[player] === true, await page.evaluate(() => state.viewer));
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
  await Promise.all(pages.map((page) => page.waitForFunction(() => state.phase === 'play')));

  await host.evaluate(() => {
    state.scores['Player 4'] = 3;
    render();
    window.ShitHeadMultiplayer.publishState();
  });
  await Promise.all(pages.map((page) => page.waitForFunction(() => state.scores['Player 4'] === 3)));

  const rejoin = await fourth.evaluate(() => JSON.parse(localStorage.getItem(`shithead-rejoin-${window.ShitHeadMultiplayer.status.roomCode}`)));
  await fourth.evaluate(() => window.ShitHeadMultiplayer.disconnect());
  await expect.poll(() => host.locator('#mpPlayers .room-player.connected').count()).toBe(3);

  const replacement = await context.newPage();
  await load(replacement);
  await replacement.locator('.multiplayer-trigger').click();
  await replacement.locator('#mpDisplayName').fill('Dee');
  await replacement.locator('#mpRoomCode').fill(rejoin.roomCode);
  await replacement.locator('.multiplayer-advanced summary').click();
  await replacement.locator('#mpRejoinPin').fill(rejoin.pin);
  await replacement.locator('#mpJoin').click();
  await replacement.waitForFunction(() => (
    window.ShitHeadMultiplayer?.status?.role === 'client'
    && window.ShitHeadMultiplayer?.status?.player === 'Player 4'
    && state.scores['Player 4'] === 3
  ));
  await expect(host.locator('#mpPlayers .room-player.connected')).toHaveCount(4);
  await expect.poll(() => host.evaluate(() => state.displayNames['Player 4'])).toBe('Dee');

  await replacement.evaluate(() => window.ShitHeadMultiplayer.disconnect());
  await replacement.close();

  const solo = await context.newPage();
  await load(solo);
  await solo.locator('#soloPlay').click();
  await solo.locator('#soloNew').click();
  await expect(solo.locator('.cpu-label')).toHaveCount(3);
  await solo.close();
  await context.close();
});
