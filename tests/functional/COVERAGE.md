# Functional multiplayer coverage

The headless browser suite currently runs three real copies of the game UI with only PeerJS transport replaced by an in-memory test double.

## Core multiplayer smoke

- create/join a three-player room;
- start from the real lobby START GAME control;
- setup state synchronized on all three pages;
- SORT works for host and clients during setup;
- third READY sent by a client moves all pages to play together;
- non-active player can SORT during play;
- client PLAY through real card + PLAY controls;
- host PLAY through real card + PLAY controls;
- client PICK UP through the real button;
- canonical state equality after every stage.

## Rules/endgame regression

- face-up play removes only that slot top and preserves its face-down card;
- an exposed face-down card is playable while other face-up cards remain;
- final K,K hand can combine with matching visible table K;
- three 8s burn;
- four-of-a-kind burn;
- 10 burn;
- same-rank follow-up does not leak hidden-hand information in shared state text;
- final-card burn still makes the player OUT;
- remaining player becomes Shit Head;
- Shit Head score increments exactly once and synchronizes;
- draw pile at zero has no visible card backing.

These tests validate the actual browser UI/render/action path and multiplayer protocol. They do not replace a real PeerJS/WebRTC network test or human gameplay/UX testing.
