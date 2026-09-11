# Shit Head

A tailored three-player online Shit Head card game.

## V1 prototype

The first build focuses on the table experience:

- Player-relative seating: the person viewing the game is always at the front/bottom of the table.
- Two opponents sit across the table with hidden hands and visible table cards.
- Three face-down, three face-up and three hand cards are dealt to each player.
- Central draw and discard piles.
- Clickable hand cards with a temporary baseline higher-card rule.
- Switchable Kitchen Table, Pub and Casino venues.
- Responsive layout for desktop and mobile browsers.
- `View as` control lets us validate the same shared state from Oliver, Dan and Chris's perspectives before live multiplayer is connected.

## Deliberately temporary

The current play rule is only a placeholder: a card may be played if it is equal to or higher than the top discard. The real house rules, special cards, pile pickup/burn behaviour, face-up/face-down endgame and multi-card plays will be implemented after the group rules are confirmed.

## Next build

1. Confirm exact house rules.
2. Implement the full game engine.
3. Add room creation/joining and realtime shared state.
4. Remove the development-only `View as` selector for normal play.
5. Add game history, Shit Head stats and personalised table details.

The app is intentionally plain HTML/CSS/JavaScript so it can be hosted directly as a static site, with realtime multiplayer added separately.

## Solo and offline play (0.9.35)

Choose **Play solo** to play against two computer opponents. Arrange your own
face-up cards and press **READY**; the CPUs arrange their cards automatically.
The normal rules engine validates every CPU move, including matching hand/table
plays, follow-ups, burns, direction changes and endgame pickups. CPU decisions
never inspect other hands, the draw order or face-down values.

Solo games save automatically on this browser/device, including setup, scores
and the current turn. **Solo · pause** opens the resume/new-game menu. Starting
a new solo game replaces its save. Online games do not overwrite the solo save.

Before travelling, open the game online and wait for **Ready for offline play**.
Bookmark the page or add it to your home screen. All local scripts, styles and
table graphics are precached; solo play and resuming work without a connection.
Online multiplayer still requires internet. Browser storage clearing removes
both the downloaded game and its save. Updates activate on the next launch after
all tabs using the previous version have closed, keeping a running game consistent.
