# Shithead Risk v1

This is the first heuristic risk engine for estimating which active player is most likely to finish as the Shit Head.

It is intentionally called **Risk v1**, not a true probability model. The output is normalised to 100% across active players so it can later be displayed as a percentage, but the underlying model is still a calibrated heuristic rather than a simulation of every possible finish.

## Core principle: unknown cards stay unknown

The public model never reads the actual identities of hidden hands, face-down table cards or draw-pile cards.

It starts from cards that everybody has genuinely seen:

- discard pile;
- burn pile;
- visible face-up table cards.

Those public cards are removed from the 52-card deck. Every remaining rank is then distributed probabilistically across all remaining hidden positions.

Example: if one 10 has been seen, three 10s remain unseen. If there are `U` unseen cards and a player owns `h` hidden cards:

```text
Expected number of 10s = h × 3 / U

P(at least one 10) = 1 - C(U - 3, h) / C(U, h)
```

The model does **not** assign one 10 to each player. It keeps the complete probability distribution for 0, 1, 2 or 3 possible 10s in each hidden set. Equal-sized hidden hands get equal prior expectations; larger hidden sets get a larger chance of containing useful or awkward cards.

Revealing a card changes the belief state immediately. If another 10 becomes public, the unseen count falls from three to two and every player's expected access to a 10 falls accordingly.

## Design goals

1. Reflect the actual house rules used by this game.
2. Reward useful escape cards and matching-card combinations.
3. Treat blind table cards as meaningfully dangerous.
4. Make a large forced pickup bad without allowing pile size to swamp every other signal.
5. Never expose hidden cards through the displayed percentages.
6. Make the public percentage identical on every browser.
7. Keep the engine pure and independent from multiplayer/game mutation code.

## Public risk score

For each active player:

```text
RiskScore = CardBurden + CardQualityRisk + TableTrap + PickupDanger - ComboStrength
```

The active players' risk scores are converted to display percentages with softmax using temperature 18.

### 1. Card burden

```text
hand card      +5
face-up card   +7
face-down card +10
```

This measures the basic amount of work still required to get out.

### 2. Card quality

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

For hidden cards, these utilities are probability-weighted from the unseen-deck belief state rather than read from the real hidden cards.

Context can increase utility:

- 10 and 2 become more valuable against a larger pile;
- 3 receives a small bonus when it can act transparently over a live card;
- 8 becomes much more valuable when it could complete a three-8 burn;
- any rank that could complete a four-of-a-kind burn receives a bonus.

Face-down cards also receive a small probability-weighted quality contribution, but much less than hand cards because they will eventually be played blind rather than chosen intelligently.

### 3. Combo strength

Matching cards are more valuable than the same cards spread across separate turns.

```text
pair   2 risk points removed
triple 5 risk points removed
four   8 risk points removed
```

For hidden hands, combo strength is an expected value over the hypergeometric distribution of the remaining ranks. The public engine therefore rewards the *chance* that a player owns a pair/triple without ever inspecting whether they actually do.

The engine also estimates the probability of the house rule where a final same-rank hand can be combined with matching visible table cards in the same play.

### 4. Table trap

Low visible table cards add extra difficulty. Blind cards add uncertainty:

```text
covered face-down card +3 trap
exposed face-down card +6 trap
```

An exposed blind card is deliberately worse because the player is now close to being forced to gamble on it. Its unknown rank is still represented by the unseen-card probability distribution.

### 5. Pickup danger

The current pile matters, but logarithmically rather than linearly:

```text
severity = 8 + 5 × ln(1 + pile size)
```

This is multiplied by the probability that the player has no legal card among their unknown hand cards.

If `L` of the `U` unseen cards are legal and a player has `h` hidden hand cards, the public engine calculates the exact probability that all `h` cards are drawn from the illegal part of the unseen deck.

Turn weighting:

```text
current player 1.00
next player    0.30
third player   0.10
```

The farther away the turn, the less confidence we have that the current pile will still be relevant.

## Public information contract

The shared/public percentage may use:

- identities of discard cards;
- identities of burned cards;
- identities of visible face-up table cards;
- number of cards in each hand;
- number and exposure state of face-down table cards;
- draw-pile count;
- current turn / pile state.

It must **not** use:

- any player's hidden hand identities, including the local viewer's;
- any face-down card identity;
- any draw-pile card identity.

Changing actual hidden cards while preserving all public facts must leave the public percentages exactly unchanged. This is covered by automated regression tests.

## APIs

### Public belief state

```js
ShitHeadBeliefStateV1.remainingRankCounts(gameState)
ShitHeadBeliefStateV1.expectedRankCount(gameState, hiddenCardCount, rank)
ShitHeadBeliefStateV1.probabilityAtLeastOneRank(gameState, hiddenCardCount, rank)
ShitHeadBeliefStateV1.rankDistributionForHiddenSet(gameState, hiddenCardCount)
ShitHeadBeliefStateV1.snapshot(gameState)
```

### Public Shithead risk

```js
ShitHeadPublicRiskV1.calculatePublicShitheadProbability(gameState)
ShitHeadPublicRiskV1.calculatePublicRiskDetails(gameState)
```

These are the APIs intended for the eventual shared coaster display.

### Private calibration engine

The earlier viewer-aware engine remains available for experiments:

```js
ShitHeadRiskV1.calculateShitheadProbability(gameState, viewerId)
ShitHeadRiskV1.calculateRiskDetails(gameState, viewerId)
```

It is not the recommended source for the shared table percentage because it may use the viewer's own hand identities.

## Calibration and tests

The branch contains:

- base heuristic tests;
- a 20-scenario calibration suite;
- belief-state tests based on the 'three 10s remain' example;
- hidden-identity invariance tests;
- CI that runs all of the above independently from the live game.

## Integration plan

Do not wire this into the live game until multiplayer is stable.

When ready:

1. Load the belief-state and public-risk modules after game state exists.
2. Calculate `calculatePublicShitheadProbability(state)` independently on every browser.
3. Confirm all browsers produce identical values.
4. Display a compact `SHITHEAD RISK` indicator beside each coaster.
5. Never broadcast the calculated percentages; they are derived entirely from public state.
6. Record completed-game snapshots later so the heuristic weights can be calibrated against real outcomes.

A later version can replace or validate the heuristic with Monte Carlo simulations of complete unseen-card allocations and plausible game continuations.
