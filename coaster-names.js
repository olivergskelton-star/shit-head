// Coaster names: readable rim lettering using upright top and bottom arcs.

function splitCoasterRimName(displayName) {
  const cleaned = String(displayName || "").trim().toUpperCase();
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (cleaned.length <= 12 || words.length < 2) return [cleaned, ""];

  let bestIndex = 1;
  let bestScore = Infinity;
  for (let i = 1; i < words.length; i += 1) {
    const top = words.slice(0, i).join(" ");
    const bottom = words.slice(i).join(" ");
    const score = Math.abs(top.length - bottom.length);
    if (score < bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  return [words.slice(0, bestIndex).join(" "), words.slice(bestIndex).join(" ")];
}

function makeCoasterNameRing(displayName, name) {
  const svgNs = "http://www.w3.org/2000/svg";
  const xlinkNs = "http://www.w3.org/1999/xlink";
  const svg = document.createElementNS(svgNs, "svg");
  svg.setAttribute("class", "beer-mat-name-ring readable-rim-name");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("aria-hidden", "true");

  const cleaned = String(displayName || "").trim();
  const [topName, bottomName] = splitCoasterRimName(cleaned);
  if (bottomName) svg.classList.add("two-arc-name");
  if (cleaned.length >= 18) svg.classList.add("long-name");
  if (cleaned.length >= 23) svg.classList.add("very-long-name");

  const suffix = `${name}-${Math.random().toString(36).slice(2, 8)}`;
  const topId = `mat-top-${suffix}`;
  const bottomId = `mat-bottom-${suffix}`;

  const defs = document.createElementNS(svgNs, "defs");
  const topPath = document.createElementNS(svgNs, "path");
  topPath.setAttribute("id", topId);
  topPath.setAttribute("d", "M 13,51 A 39,39 0 0,1 87,51");
  defs.append(topPath);

  const bottomPath = document.createElementNS(svgNs, "path");
  bottomPath.setAttribute("id", bottomId);
  // Right-to-left path keeps the lower lettering upright to the viewer.
  bottomPath.setAttribute("d", "M 87,55 A 39,39 0 0,1 13,55");
  defs.append(bottomPath);
  svg.append(defs);

  function addArc(textValue, pathId, className) {
    if (!textValue) return;
    const text = document.createElementNS(svgNs, "text");
    text.setAttribute("class", className);
    const textPath = document.createElementNS(svgNs, "textPath");
    textPath.setAttribute("href", `#${pathId}`);
    textPath.setAttributeNS(xlinkNs, "xlink:href", `#${pathId}`);
    textPath.setAttribute("startOffset", "50%");
    textPath.setAttribute("text-anchor", "middle");
    textPath.textContent = textValue;
    text.append(textPath);
    svg.append(text);
  }

  addArc(topName, topId, "name-top");
  addArc(bottomName, bottomId, "name-bottom");
  return svg;
}

makeBeerMat = function makeBeerMatWrapped(name, extraClass = "", editable = false) {
  const profile = PLAYER_PROFILE[name];
  const displayName = publicName(name);
  const mat = document.createElement(editable ? "button" : "div");
  if (editable) mat.type = "button";
  mat.className = `beer-mat ${extraClass}${editable ? " editable" : ""}`.trim();

  mat.append(makeCoasterNameRing(displayName, name));

  const score = document.createElement("span");
  score.className = "beer-mat-score";
  score.textContent = profile.score;

  const drink = document.createElement("span");
  drink.className = "beer-mat-drink";
  drink.setAttribute("aria-hidden", "true");
  drink.textContent = profile.icon;

  mat.append(score, drink);

  if (editable) {
    const edit = document.createElement("span");
    edit.className = "beer-mat-edit";
    edit.textContent = "✎";
    mat.append(edit);
  }

  mat.setAttribute("aria-label", `${displayName}, score ${profile.score}${editable ? ". Click to change weekly name." : ""}`);
  if (editable) mat.addEventListener("click", () => editDisplayName(name));
  return mat;
};

render();
