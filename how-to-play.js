// Accessible rules overlay, deliberately isolated from game state and rendering.

const howToPlayButton = document.querySelector("#howToPlayBtn");
const howToPlayDialog = document.querySelector("#howToPlayDialog");
const closeHowToPlayButton = document.querySelector("#closeHowToPlayBtn");
const gotItButton = document.querySelector("#gotItBtn");

function openHowToPlay() {
  if (!howToPlayDialog) return;
  document.body.classList.add("how-to-play-open");
  if (typeof howToPlayDialog.showModal === "function") howToPlayDialog.showModal();
  else howToPlayDialog.setAttribute("open", "");
}

function closeHowToPlay() {
  if (!howToPlayDialog) return;
  document.body.classList.remove("how-to-play-open");
  if (typeof howToPlayDialog.close === "function") howToPlayDialog.close();
  else howToPlayDialog.removeAttribute("open");
}

howToPlayButton?.addEventListener("click", openHowToPlay);
closeHowToPlayButton?.addEventListener("click", closeHowToPlay);
gotItButton?.addEventListener("click", closeHowToPlay);

howToPlayDialog?.addEventListener("click", (event) => {
  if (event.target === howToPlayDialog) closeHowToPlay();
});

howToPlayDialog?.addEventListener("close", () => {
  document.body.classList.remove("how-to-play-open");
  howToPlayButton?.focus();
});

// Multiplayer is loaded last so it can wrap the finished game renderer without
// changing the existing table/layout scripts.
(function loadMultiplayer() {
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = "multiplayer.css?v=20260827-4";
  document.head.append(css);

  const peerScript = document.createElement("script");
  peerScript.src = "https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js";
  peerScript.onload = () => {
    const multiplayerScript = document.createElement("script");
    multiplayerScript.src = "multiplayer.js?v=20260827-4";
    document.body.append(multiplayerScript);
  };
  peerScript.onerror = () => console.warn("Shit Head multiplayer library could not be loaded.");
  document.body.append(peerScript);
})();
