from __future__ import annotations

import base64
import io
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ATLAS_DIR = ROOT / "assets" / "atlas"
OUT_DIR = ROOT / "assets" / "table"
CELL = 112

ASSETS = {
    "coffee.png": (0, 0),
    "craft-beer.png": (1, 0),
    "guinness.png": (2, 0),
    "tea.png": (3, 0),
    "jd-coke.png": (4, 0),
    "lager.png": (0, 1),
    "lemonade.png": (1, 1),
    "martini.png": (2, 1),
    "milk.png": (3, 1),
    "mojito.png": (4, 1),
    "pina-colada.png": (0, 2),
    "red-wine.png": (1, 2),
    "herbal-tea.png": (2, 2),
    "white-wine.png": (3, 2),
    "coaster-casino.png": (4, 2),
    "coaster-kitchen.png": (0, 3),
    "coaster-pub.png": (1, 3),
    "snack-crisps.png": (2, 3),
    "snack-nuts.png": (3, 3),
    "snack-olives.png": (4, 3),
}

parts = sorted(ATLAS_DIR.glob("part-*.txt"))
if len(parts) != 15:
    raise SystemExit(f"Expected 15 verified atlas chunks, found {len(parts)}")

encoded = "".join(part.read_text(encoding="utf-8").strip() for part in parts)
atlas_bytes = base64.b64decode(encoded, validate=True)
atlas = Image.open(io.BytesIO(atlas_bytes)).convert("RGBA")
if atlas.size != (560, 448):
    raise SystemExit(f"Unexpected atlas size {atlas.size}; expected 560x448")

OUT_DIR.mkdir(parents=True, exist_ok=True)
for name, (col, row) in ASSETS.items():
    left = col * CELL
    top = row * CELL
    image = atlas.crop((left, top, left + CELL, top + CELL))
    image.save(OUT_DIR / name, "PNG", optimize=True)

print(f"Materialised {len(ASSETS)} direct PNG assets in {OUT_DIR}")
