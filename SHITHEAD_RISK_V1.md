# Shithead Risk v1

This is the first heuristic risk engine for estimating which active player is most likely to finish as the Shit Head.

It is intentionally called **Risk v1**, not a true probability model. The output is normalised to 100% across active players so it can later be displayed as a percentage, but the underlying model is a calibrated heuristic rather than a simulation of every possible finish.

## Design goals

1. Reflect the actual house rules used by this game.
2. Reward useful escape cards and matching-card combinations.
3. Treat blind table cards as meaningfully dangerous.
4. Make a large forced pickup bad without allowing pile size to swamp every other signal.
5. Never reveal or infer exact hidden opponent cards through a public percentage.
6. Keep the engine pure and independent from multiplayer/game mutation code.

## Risk score

For each active player:

```text
RiskScore = CardBurden + CardQualityRisk + TableTrap + PickupDanger - ComboStrength
```

The active players' risk scores are converted to display percentages with softmax using temperature 18.

## 1. Card burden

```text
hand card      +5
face-up card   +7
face-down card +10
```

This measures the basic amount of work still required to get out.

## 2. Card quality

Baseline escape utility:

| Rank | Utility |
|---|---:|
| 10 | +6 |
| 2 | +5 |
| 3 | +4 |
| A | +3.5 |
| K | +3 |
| Q | +2 |
| 7 | +2 |
| 8 | +1 |
| J | +1 |
| 9 | 0 |
| 6 | -1 |
| 5 | -2 |
| 4 | -3 |

Useful cards reduce risk. Context can increase utility:

- 10 and 2 become more valuable against a larger pile.
- 3 receives a small bonus when it can act transparently over a live card.
- 8 becomes much more valuable when it can complete a three-8 burn.
- any rank that can complete a four-of-a-kind burn receives a bonus.

## 3. Combo strength

Matching cards are more valuable than the same cards spread across separate turns.

```text
pair   2 risk points removed
triple 5 risk points removed
four   8 risk points removed
```

The engine also rewards the house rule where a final same-rank hand can be combined with matching visible table cards in the same play.

## 4. Table trap

Low visible table cards add extra difficulty. Blind cards add uncertainty:

```text
covered face-down card +3 trap
exposed face-down card +6 trap
```

An exposed blind card is deliberately worse because the player is now close to being forced to gamble on it.

## 5. Pickup danger

The current pile matters, but logarithmically rather than linearly:

```text
severity = 8 + 5 * ln(1 + pile size)
```

This is multiplied by the estimated probability that the player has no legal play.

Turn weighting:

```text
current player 1.00
next player    0.30
third player   0.10
```

The farther away the turn, the less confidence we have that the current pile will still be relevant.

## Hidden-information contract

The local viewer may use:

- their own hand,
- every visible face-up table card,
- the discard pile,
- the burn pile,
- public card counts and current turn state.

The engine must **not** inspect:

- another player's hidden hand identities,
- any player's face-down card identities.

For opponents, hidden-hand quality, combinations and legal-play chance are estimated from the remaining unseen deck distribution.

A regression test explicitly replaces an opponent's hidden hand with completely different cards while keeping the same card count and verifies that the viewer's published risk percentages do not change.

## Current API

```js
ShitHeadRiskV1.calculateShitheadProbability(gameState, viewerId)
ShitHeadRiskV1.calculateRiskDetails(gameState, viewerId)
ShitHeadRiskV1.getRiskStatus(percent)
```

`calculateRiskDetails` exposes the component scores for calibration and debugging. It is not intended to be shown directly to other players.

## Calibration scenarios

Initial tests cover:

- active probabilities sum to 100%,
- OUT players receive 0%,
- opponent hidden-card identities cannot affect another viewer's public result,
- three exposed blind cards against a large pile produce the highest risk in a representative scenario,
- a final pair plus a matching visible table card improves the position,
- holding a 10 removes immediate forced-pickup danger that low illegal cards create.

## Integration plan

Do not wire this into the live game until multiplayer is stable.

When ready:

1. Load the pure engine after game state exists.
2. Calculate percentages locally on each browser using that browser's `state.viewer`.
3. Display a compact `SHITHEAD %` indicator beside each coaster.
4. Never broadcast calculated percentages through multiplayer state; each browser calculates its own privacy-safe view.
5. Record completed-game snapshots later so the weights can be calibrated against real outcomes.

A later v2 can replace the heuristic with Monte Carlo simulations of unknown card distributions and plausible game continuations.