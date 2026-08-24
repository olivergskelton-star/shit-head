// Coaster names: run the weekly joke name around a true circular rim path.

function makeCoasterNameRing(displayName, name) {
  const svgNs = "http://www.w3.org/2000/svg";
  const xlinkNs = "http://www.w3.org/1999/xlink";
  const svg = document.createElementNS(svgNs, "svg");
  svg.setAttribute("class", "beer-mat-name-ring circular-name");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("aria-hidden", "true");

  const cleaned = String(displayName || "").trim();
  if (cleaned.length >= 16) svg.classList.add("long-name");
  if (cleaned.length >= 22) svg.classList.add("very-long-name");

  const suffix = `${name}-${Math.random().toString(36).slice(2, 8)}`;
  const pathId = `mat-ring-${suffix}`;

  const defs = document.createElementNS(svgNs, "defs");
  const path = document.createElementNS(svgNs, "path");
  path.setAttribute("id", pathId);
  path.setAttribute("d", "M 50,7 A 43,43 0 1,1 49.9,7");
  defs.append(path);
  svg.append(defs);

  const text = document.createElementNS(svgNs, "text");
  const textPath = document.createElementNS(svgNs, "textPath");
  textPath.setAttribute("href", `#${pathId}`);
  textPath.setAttributeNS(xlinkNs, "xlink:href", `#${pathId}`);
  textPath.setAttribute("startOffset", "50%");
  textPath.setAttribute("text-anchor", "middle");
  textPath.textContent = cleaned.toUpperCase();
  text.append(textPath);
  svg.append(text);

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
