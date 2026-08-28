# Three-browser functional test

This suite drives three real copies of the Shit Head web UI in headless Chromium while replacing only the external PeerJS transport with an in-memory test double.

## Purpose

Catch multiplayer regressions before human three-browser testing.

The smoke path currently verifies:

1. Oliver creates a room.
2. Dan and Chris join.
3. Host starts a game.
4. All three browsers agree on setup state.
5. SORT works for host and clients during setup.
6. READY from all three, with the third READY deliberately sent by client Chris, moves every browser into one synchronized play phase.
7. SORT works for a non-active client during play.
8. Client Dan selects a real hand card and clicks the real PLAY button; host and all clients synchronize.
9. Host Oliver selects a real hand card and clicks the real PLAY button; all clients synchronize.
10. Client Chris clicks the real PICK UP button; the pile and hand changes synchronize.

Every synchronization checkpoint compares phase, current/starting player, draw count, discard, burn pile, ready flags/order, hand identities and canonical three-slot table state.

## Rule

A multiplayer release should not be treated as ready for human testing unless this smoke suite is green. Extend this suite with each multiplayer/rules regression so fixed bugs stay fixed.
