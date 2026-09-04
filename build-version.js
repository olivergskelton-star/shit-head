// Single visible build identifier for browser testing.
// Increment this on every deployed change so testers can verify the live files.
window.SHITHEAD_BUILD = "0.9.29";

(() => {
  const host = document.querySelector('.topbar > div:first-child');
  if (!host) return;

  const badge = document.createElement('span');
  badge.id = 'buildBadge';
  badge.textContent = `Build ${window.SHITHEAD_BUILD}`;
  badge.setAttribute('aria-label', `S**t Head build ${window.SHITHEAD_BUILD}`);
  badge.style.cssText = [
    'display:inline-block',
    'margin-top:4px',
    'padding:3px 7px',
    'border:1px solid rgba(255,255,255,.28)',
    'border-radius:999px',
    'font-size:11px',
    'font-weight:700',
    'letter-spacing:.04em',
    'color:rgba(255,255,255,.78)',
    'background:rgba(0,0,0,.22)'
  ].join(';');
  host.append(badge);

  [
    'player-status-mobile-0921.css',
    'player-status-desktop-0922.css',
    'table-assets-0922.css',
    'table-atlas-runtime-0922.css',
    'mobile-drinks-0925.css',
    'drink-centering-0927.css',
    'desktop-visual-0928.css',
  ].forEach((href) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = `${href}?v=${window.SHITHEAD_BUILD}`;
    document.head.append(css);
  });

  document.addEventListener('DOMContentLoaded', () => {
    [
      'player-status-rounding-0921.js',
      'table-atlas-runtime-0922.js',
    ].forEach((src) => {
      const script = document.createElement('script');
      script.async = false;
      script.src = `${src}?v=${window.SHITHEAD_BUILD}`;
      document.body.append(script);
    });
  }, { once: true });
})();
