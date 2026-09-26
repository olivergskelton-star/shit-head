const VERSION = "shithead-offline-0.9.41";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./solo-icon.svg",
  "./app.js",
  "./build-version.js",
  "./card-corners.css",
  "./coaster-names.css",
  "./coaster-names.js",
  "./coaster-v2.css",
  "./desktop-visual-0928.css",
  "./drink-centering-0927.css",
  "./engine-v2.css",
  "./engine-v2.js",
  "./game-feel-0915.css",
  "./game-feel-0915.js",
  "./game-ticker.css",
  "./game-ticker.js",
  "./hand-tools.css",
  "./hand-tools.js",
  "./how-to-play.css",
  "./how-to-play.js",
  "./mobile-drinks-0925.css",
  "./mobile-layout.css",
  "./mobile-portrait-polish.css",
  "./multiplayer-authoritative-play.js",
  "./multiplayer-handshake-fix.js",
  "./multiplayer-lobby-ux.js",
  "./multiplayer-play-selection-fix-v2.js",
  "./multiplayer-play-selection-fix.js",
  "./multiplayer.css",
  "./multiplayer.js",
  "./opening-rule.js",
  "./player-status-0920.css",
  "./player-status-0920.js",
  "./player-status-desktop-0922.css",
  "./player-status-mobile-0921.css",
  "./player-status-rounding-0921.js",
  "./round-score-0917.js",
  "./setup-phase.css",
  "./setup-phase.js",
  "./shithead-belief-state-v1.js",
  "./shithead-public-risk-v1.js",
  "./shithead-risk-v1.js",
  "./solo-mode.css",
  "./solo-mode.js",
  "./styles.css",
  "./table-assets-0922.css",
  "./table-assets-0922.js",
  "./table-atlas-runtime-0922.css",
  "./table-atlas-runtime-0922.js",
  "./table-card-play.js",
  "./table-perspective.css",
  "./table-polish.css",
  "./table-state-ui.css",
  "./table-state-ui.js",
  "./table-layout-0941.css",
  "./table-layout-0941.js",
  "./assets/table/coaster-casino.png",
  "./assets/table/coaster-kitchen.png",
  "./assets/table/coaster-pub.png",
  "./assets/table/coffee.png",
  "./assets/table/craft-beer.png",
  "./assets/table/guinness.png",
  "./assets/table/herbal-tea.png",
  "./assets/table/jd-coke.png",
  "./assets/table/lager.png",
  "./assets/table/lemonade.png",
  "./assets/table/martini.png",
  "./assets/table/milk.png",
  "./assets/table/mojito.png",
  "./assets/table/pina-colada.png",
  "./assets/table/red-wine.png",
  "./assets/table/snack-crisps.png",
  "./assets/table/snack-nuts.png",
  "./assets/table/snack-olives.png",
  "./assets/table/tea.png",
  "./assets/table/white-wine.png"
];
const cacheName = VERSION + ':' + self.registration.scope;
self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(cacheName);
  await cache.addAll(ASSETS.map(url => new Request(url, {cache:'reload'})));
  // Keep a running game's code consistent. Activate the new cache on next launch.
})()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) {
    if (key.startsWith('shithead-offline-') && key.endsWith(':'+self.registration.scope) && key!==cacheName) await caches.delete(key);
  }
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method!=='GET' || url.origin!==self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(event.request,{ignoreSearch:true});
    if(cached) return cached;
    return fetch(event.request);
  })());
});
self.addEventListener('message', event => {
  if(event.data?.type!=='CHECK_READY') return;
  event.waitUntil((async () => {
    const cache=await caches.open(cacheName);
    const ready=(await Promise.all(ASSETS.map(url=>cache.match(url)))).every(Boolean);
    event.ports[0]?.postMessage({ready});
  })());
});
