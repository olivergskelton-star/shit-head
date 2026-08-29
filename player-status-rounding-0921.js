// Build 0.9.21: keep the displayed public Shithead percentages at exactly 100%.
(() => {
  function normalizeDisplayedRisk() {
    const rows = [...document.querySelectorAll('.player-notepad .notepad-risk .notepad-value')];
    if (!rows.length) return;

    const values = rows.map((row) => Number(String(row.textContent || '').replace('%', '')));
    if (values.some((value) => !Number.isFinite(value))) return;

    const total = values.reduce((sum, value) => sum + value, 0);
    const delta = 100 - total;
    if (!delta) return;

    let targetIndex = 0;
    for (let index = 1; index < values.length; index += 1) {
      if (values[index] > values[targetIndex]) targetIndex = index;
    }

    const corrected = Math.max(0, values[targetIndex] + delta);
    values[targetIndex] = corrected;
    rows[targetIndex].textContent = `${corrected}%`;

    const pad = rows[targetIndex].closest('.player-notepad');
    if (pad) {
      const name = pad.dataset.player;
      const score = pad.querySelector('.notepad-score .notepad-value')?.textContent || '0';
      pad.setAttribute('aria-label', `${typeof publicName === 'function' ? publicName(name) : name}, score ${score}, Shithead Risk ${corrected} percent`);
    }
  }

  const renderBeforeRiskRounding0921 = render;
  render = function renderWithRiskRounding0921() {
    renderBeforeRiskRounding0921();
    normalizeDisplayedRisk();
  };

  normalizeDisplayedRisk();
})();
