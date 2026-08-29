#!/bin/sh
# Run after saving docs/board.png and docs/ticket.png
set -e
cd "$(dirname "$0")"
[ -f docs/board.png ]  || { echo "missing docs/board.png";  exit 1; }
[ -f docs/ticket.png ] || { echo "missing docs/ticket.png"; exit 1; }
python - <<'PY'
import io
p='README.md'; s=io.open(p,encoding='utf-8').read()
anchor = "---\n\n## The problem"
block = """---

## What it looks like

**The board** — what goes on the projector. Supporters flip in as they join, rows fill by cohort, and `PAID` lands on each one when the payout clears.

![DayOne board with 25 supporters paid across three cohorts](docs/board.png)

**The ticket** — what a supporter sees on their phone after one tap.

![DayOne join ticket showing rank #1, Row 1](docs/ticket.png)

---

## The problem"""
if 'docs/board.png' not in s:
    io.open(p,'w',encoding='utf-8').write(s.replace(anchor, block, 1))
PY
git add -A
git commit -q -m "README: board and ticket screenshots"
git push -q
echo "screenshots added and pushed"
