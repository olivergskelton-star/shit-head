// Opening-rule safeguard: enforce lowest HAND card as the starting player after setup.
// Loaded last so no earlier setup/render layer can leave the random/current viewer as starter.

function enforceOpeningStarter() {
  if (state.phase !== "play") return null;

  const order = typeof STARTING_RANK_ORDER !== "undefined"
    ? STARTING_RANK_ORDER
    : ["4", "5", "6", "7", "8", "9", "J", "Q", "K", "A", "2", "3", "10"];

  for (const rank of order) {
    const holders = PLAYER_NAMES.filter((name) =>
      state.players[name]?.hand?.some((card) => card.rank === rank)
    );
    if (!holders.length) continue;

    const readyOrder = Array.isArray(state.setupReadyOrder) ? state.setupReadyOrder : [];
    const starter = readyOrder.find((name) => holders.includes(name)) || holders[0];
    state.startingPlayer = starter;
    state.currentPlayer = starter;
    state.openingRank = rank;
    state.openingHolders = holders;
    return { starter, rank, holders };
  }

  return null;
}

if (typeof markSetupReady === "function") {
  const markSetupReadyBeforeOpeningRule = markSetupReady;
  markSetupReady = function markSetupReadyWithOpeningRule(name) {
    const wasSetup = state.phase === "setup";
    markSetupReadyBeforeOpeningRule(name);

    if (wasSetup && state.phase === "play") {
      const opening = enforceOpeningStarter();
      if (opening) {
        const tied = opening.holders.length > 1;
        state.lastMessage = tied
          ? `${publicName(opening.starter)} starts with the lowest hand card (${opening.rank}); READY order broke the tie.`
          : `${publicName(opening.starter)} starts with the lowest hand card (${opening.rank}).`;
        render();
      }
    }
  };
}
