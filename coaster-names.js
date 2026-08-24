// Coaster name wrapping: short names use one top arc; longer joke names wrap across top + bottom arcs.

function splitCoasterName(displayName) {
  const words = String(displayName || "").trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1 || displayName.length <= 12) return [displayName, ""];

  let bestIndex = 1;
  let bestDifference = Infinity;
  for (let i = 1; i < words.length; i += 1) {
    const top = words.slice(0, i).join(" ");
    const bottom = words.slice(i).join(" ");
    const difference = Math.abs(top.length - bottom.length);
    if (difference < bestDifference) {
      bestDifference = difference;
      bestIndex = i;
    }
  }

  return [words.slice(0, bestIndex).join(" "), words.slice(bestIndex).join(" ")];
}

function makeCoasterNameRing(displayName, name) {
  const svgNs = "http://www.w3.org/2000/svg";
  const xlinkNs = "http://www.w3.org/1999/xlink";
  const svg = document.createElementNS(svgNs, "svg");
  svg.setAttribute("class", "beer-mat-name-ring");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("aria-hidden", "true");

  const [topName, bottomName] = splitCoasterName(displayName);
  if (bottomName) svg.classList.add("wrapped-name");
  if (displayName.length >= 19) svg.classList.add("very-long-name");

  const suffix = `${name}-${Math.random().toString(36).slice(2, 8)}`;
  const topPathId = `mat-top-${suffix}`;
  const bottomPathId = `mat-bottom-${suffix}`;

  const defs = document.createElementNS(svgNs, "defs");
  const topPath = document.createElementNS(svgNs, "path");
  topPath.setAttribute("id", topPathId);
  topPath.setAttribute("d", "M 15,53 A 39,39 0 0,1 85,53");
  defs.append(topPath);

  if (bottomName) {
    const bottomPath = document.createElementNS(svgNs, "path");
    bottomPath.setAttribute("id", bottomPathId);
    bottomPath.setAttribute("d", "M 15,47 A 39,39 0 0,0 85,47");
    defs.append(bottomPath);
  }
  svg.append(defs);

  function appendText(textValue, pathId, className) {
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

  appendText(topName, topPathId, "name-top");
  if (bottomName) appendText(bottomName, bottomPathId, "name-bottom");
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

  const label = document.createElement("span");
  label.className = "beer-mat-label";
  label.textContent = profile.drink;

  mat.append(score, drink, label);

  if (editable) {
    const edit = document.createElement("span");
    edit.className = "beer-mat-edit";
    edit.textContent = "✎";
    mat.append(edit);
  }

  mat.setAttribute("aria-label", `${displayName}, score ${profile.score}, drinking ${profile.drink}${editable ? ". Click to change weekly name." : ""}`);
  if (editable) mat.addEventListener("click", () => editDisplayName(name));
  return mat;
};

render();
