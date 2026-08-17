# Minesweeper Aim Trainer

A 2D click trainer in the style of Aim Lab's Gridshot/Microshot, themed around
Minesweeper's core mechanic: left-click to reveal a safe cell, right-click to
flag a mine. No gun, no 3D — just squares and your cursor.

## Running it

No build step. Open `index.html` directly in a browser, or serve the folder
with any static file server, e.g.:

```bash
python -m http.server 8123
```

then visit `http://localhost:8123`.

## How it works

Each run generates a real Minesweeper **Intermediate board** (16×16, 40
mines) behind the scenes. The board itself is never shown — only individual
cells appear on screen as floating squares, at the position they'd occupy on
that board:

- 🟦 **Blue square** = a safe cell → **left-click** to reveal it.
- 🟥 **Red square** (flag icon) = a mine → **right-click** to flag it.
- Clicking with the wrong button, or missing a square entirely, counts as a
  miss and costs accuracy.

## Modes

- **Random** — every square is picked uniformly at random from anywhere on
  the board.
- **Solve Flow** — mimics how someone actually plays Minesweeper. It
  computes real neighbor-mine counts and simulates cascading reveals, so
  targets are only ever drawn from the "frontier" (cells adjacent to
  already-revealed ones). Most picks are the nearest unresolved frontier
  cell to the last one (tight local clustering); occasionally (tunable via
  **Jump Chance**) it jumps to a distant unfinished pocket, or opens a fresh
  region if none remains.

## Settings

| Setting | Options | Notes |
|---|---|---|
| Duration | 30 / 60 / 90s | Run length |
| Tile Size | Small / Medium / Large | Target size |
| Squares at Once | 1 / 3 / 5 / 8 | Concurrent targets on screen |
| Jump Chance | 5–30% | Solve Flow only |

When a board is fully cleared before time runs out, a fresh board is
generated and play continues.

## Results

At the end of a run you get score, hits, misses, overall accuracy, average
reaction time, targets/sec, best streak, and separate accuracy for left- and
right-click attempts (tracked by which button you actually pressed, so a
missed empty-space click counts against the matching button's accuracy too).
