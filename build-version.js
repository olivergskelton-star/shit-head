// Single visible build identifier for browser testing.
// Increment this on every deployed change so testers can verify the live files.
window.SHITHEAD_BUILD = "0.9.21";

(() => {
  const host = document.querySelector('.topbar > div:first-child');
  if (!host) return;

  const badge = document.createElement('span');
  badge.id = 'buildBadge';
  badge.textContent = `Build ${window.SHITHEAD_BUILD}`;
  badge.setAttribute('aria-label', `Shit Head build ${window.SHITHEAD_BUILD}`);
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

  // 0.9.21 is deliberately a tiny visual/display patch. Load its mobile CSS now;
  // load its risk-rounding wrapper after the parser-loaded game scripts exist.
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = `player-status-mobile-0921.css?v=${window.SHITHEAD_BUILD}`;
  document.head.append(css);

  document.addEventListener('DOMContentLoaded', () => {
    const script = document.createElement('script');
    script.src = `player-status-rounding-0921.js?v=${window.SHITHEAD_BUILD}`;
    document.body.append(script);
  }, { once: true });
})();
