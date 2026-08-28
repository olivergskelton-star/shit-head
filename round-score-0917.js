// 0.9.17 round scoring.
// The last player left is the Shit Head and receives one point on the coaster.
// Scores live in shared state so the host broadcasts the same tally to everyone.
(() => {
  function ensureScores() {
    if (!state.scores || typeof state.scores !== 'object') {
      state.scores = Object.fromEntries(PLAYER_NAMES.map((name) => [name, Number(PLAYER_PROFILE?.[name]?.score) || 0]));
    }
    PLAYER_NAMES.forEach((name) => {
      if (!Number.isFinite(Number(state.scores[name]))) state.scores[name] = 0;
    });
  }

  function syncProfileScores() {
    ensureScores();
    PLAYER_NAMES.forEach((name) => {
      if (PLAYER_PROFILE?.[name]) PLAYER_PROFILE[name].score = Number(state.scores[name]) || 0;
    });
  }

  ensureScores();
  if (typeof state.roundScored !== 'boolean') state.roundScored = false;
  syncProfileScores();

  const dealBeforeRoundScore = dealNewGame;
  dealNewGame = function dealNewGameWithScoreReset() {
    state.roundScored = false;
    state.shitHead = null;
    state.finishOrder = [];
    return dealBeforeRoundScore();
  };

  const renderBeforeRoundScore = render;
  render = function renderWithRoundScore0917() {
    ensureScores();

    if (state.phase === 'gameover' && state.shitHead && !state.roundScored) {
      const loser = state.shitHead;
      state.scores[loser] = (Number(state.scores[loser]) || 0) + 1;
      state.roundScored = true;
      const score = state.scores[loser];
      const base = state.lastMessage || `${publicName(loser)} is the Shit Head. Game over.`;
      state.lastMessage = `${base} ${publicName(loser)}’s score is now ${score}.`;
    }

    syncProfileScores();
    renderBeforeRoundScore();
  };

  render();
})();