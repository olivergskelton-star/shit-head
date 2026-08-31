from pathlib import Path

FIXES = (
    (Path("assets/atlas/part-07.txt"), 1432, "J"),
    (Path("assets/atlas/part-12.txt"), 3208, "u"),
)

for path, index, char in FIXES:
    text = path.read_text(encoding="utf-8").strip()
    if len(text) == 8000:
        continue
    if len(text) != 7999:
        raise RuntimeError(f"{path} has unexpected length {len(text)}")
    repaired = text[:index] + char + text[index:]
    if len(repaired) != 8000:
        raise RuntimeError(f"{path} repair produced length {len(repaired)}")
    path.write_text(repaired, encoding="utf-8")
    print(f"Repaired {path}: inserted {char!r} at {index}")
