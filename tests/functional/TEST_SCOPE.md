# Next regression scenarios

After the core three-browser smoke is green, extend with these real-UI multiplayer paths:

- face-up table play leaves the face-down card in the same slot untouched;
- exposed face-down card can be selected blind without waiting for other face-up cards;
- two exposed blind slots remain independently selectable;
- final same-rank hand can combine with matching visible face-up table card;
- 10 burn;
- three 8s burn;
- four-of-a-kind burn;
- transparent 3;
- 7 forces low play;
- voluntary pickup;
- large pickup hand remains playable/sortable;
- OUT players are skipped;
- final-card burn still marks player OUT;
- second player OUT ends round with remaining player as Shit Head;
- Shit Head score increments once and synchronizes;
- draw stack backing disappears at draw count zero;
- shared ticker never reveals hidden-hand information.

Each regression test must interact through the real rendered controls where practical and assert canonical state equality across all three pages after every multiplayer action.
