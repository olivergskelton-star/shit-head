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
