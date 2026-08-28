# Shithead Risk v1 — Calibration Suite

This document records the behavioural contract for the first heuristic Shithead Risk engine.

The objective is not to claim mathematically proven loss probabilities. V1 should produce rankings and movements that experienced players recognise as sensible, while never exposing hidden card identities.

## Two legitimate views

### Public table risk

Use a viewer ID that belongs to nobody (the calibration suite uses `__PUBLIC__`). The engine then treats **every hand as unknown** and uses only:

- hand counts;
- visible face-up table cards;
- number / exposure state of face-down cards;
- discard pile;
- burn pile;
- draw-pile state;
- whose turn it is;
- public house-rule opportunities such as a visible burn completion.

This result is safe to show beside all three coasters because every browser can calculate the same values without inspecting hidden hands.

### Private/self risk

Pass the real viewer/player ID. The engine may then use that player's own hand identities while continuing to estimate opponent hands from unseen-card distributions.

This gives a more intelligent personal assessment, e.g. it knows that your six-card hand contains two 10s, a 2 and a 3 rather than six random unknown cards.

If this view is ever shown in the UI it should be labelled as **your** risk and not presented as a shared public number.

---

## Calibration scenarios

The automated calibration test contains 20 behavioural scenarios.

### 1. Huge pickup hand

A 13-card pickup hand must be materially riskier than the same table position with four cards.

**Why:** raw card burden should remain the strongest simple predictor.

### 2. Card quality can offset card count

Six excellent escape cards (10, 10, 2, 3, A, K) should be safer than four awkward low cards in an otherwise equivalent private/self position.

**Why:** card count alone must not turn the meter into a glorified hand counter.

### 3. Triple combination

Q-Q-Q should score safer than a similarly valued three-card hand with no matching ranks.

**Why:** three cards that can leave in one action are materially better than three separate plays.

### 4. Final-hand + table match

With the draw pile empty, K-K in hand plus a visible table K should score safer than K-K with a non-matching visible table card.

**Why:** under the house rule all three Kings can leave together.

### 5. Three-8 burn opportunity

Holding an 8 when two 8s already sit on top of the pile should materially lower immediate risk compared with an ordinary pile.

**Why:** that 8 clears the pile and retains the turn.

### 6. Exposed blind uncertainty

Three exposed face-down cards should carry a larger uncertainty/trap component than three face-down cards still protected by strong visible cards.

### 7. Bad visible table

A visible 4-5-6 table should score much worse than 10-A-K.

**Why:** visible table quality becomes increasingly important once the draw pile disappears.

### 8. Immediate danger versus future speculation

A player who cannot answer the pile **now** receives much more pickup danger than the same player two turns away.

**Why:** intervening plays can completely change the pile.

### 9. Pickup pile size is sublinear

Twenty cards in the pile are worse than five, but not four times worse.

**Why:** the original `pile size × 15` proposal overwhelms every other signal and creates unrealistic 90%+ swings.

### 10. A 10 escapes pickup danger

If an otherwise trapped player holds a 10, immediate pickup danger becomes zero.

### 11. Seven rule

On a live 7, ordinary high cards such as Q/K/A cannot answer it, while 4/5/6 can.

### 12. Transparent 3

A 3 on top of a K leaves the K live. A Q remains illegal; 3 and 10 remain legal.

### 13. Three exposed blinds / substantial pile

The calibration case requested in the original probability proposal remains: a player stranded on three exposed blind cards while facing a substantial pile should rank as the most vulnerable of otherwise sensible opponents.

### 14. OUT player

An OUT player has 0% Shithead risk for that round.

### 15. Game over

Once the final Shit Head is known, that player is 100% and everyone else is 0%.

### 16. Opponent hidden-hand privacy

Replacing Dan's hidden hand with completely different card identities while keeping the same hand count must not change Oliver's estimates.

### 17. Public result is browser-independent

Changing local `View As` must not change `__PUBLIC__` risk values.

### 18. Public result ignores every hidden hand identity

Public risk remains identical when opponent hidden cards are replaced while preserving hand counts.

### 19. Multiple exposed blind choices

Having three exposed blind positions does not pretend that the player knows which blind card is good. Immediate legality is estimated from one unseen card distribution.

### 20. Normalisation

All active-player public risk percentages sum to exactly 100%.

---

## What the first calibration pass suggests

The current weights are directionally healthy enough to continue with V1:

- very large pickup hands become clear favourites for Shit Head;
- forced pickup risk spikes on the current player's turn but falls sharply for future turns;
- strong special cards can offset some extra card burden;
- low visible table cards are strongly penalised;
- exposed blind cards create a meaningful late-game risk premium;
- pairs/triples and final-hand/table combinations are recognised as escape routes;
- burn opportunities improve the position;
- pile-size danger grows logarithmically rather than swamping the model;
- hidden opponent card identities do not affect published estimates.

## Deliberate limitations of V1

V1 is a heuristic risk model, not a simulation of every possible continuation.

It does not yet model:

- opponent strategy;
- deliberate pile pickup as a tactical choice;
- memory/inference from earlier plays beyond known-card removal;
- exact probability of future players changing the pile;
- sequence value of combinations beyond the current heuristic;
- Monte Carlo continuation to actual observed loss frequency.

Those belong in a later Shithead Probability engine once the game itself is stable and we have real completed-game data for calibration.

## UI recommendation

When the feature reaches the table:

- use **public table risk** for the percentage beside each coaster;
- initially label it `SHITHEAD RISK`, not `PROBABILITY`;
- consider a separate private `YOUR RISK` detail later;
- do not show diagnostic component values during normal play;
- preserve the diagnostic API for tuning and test analysis.
