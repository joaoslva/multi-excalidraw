#!/usr/bin/env bash
# Compares three ways of showing one board to an agent: the raw file, a text outline, and
# rendered images. Needs only Docker. Usage: scripts/measure-board.sh <board.excalidraw> [out dir]
# Writes outline.md and board-<w>x<h>.png into the out dir (default ./measure-out/<board name>)
# and prints a size table. See the "Agent access" note in the vault for how to use the result.
set -euo pipefail

cd "$(dirname "$0")/.."
. scripts/lib.sh

BOARD="${1:?usage: scripts/measure-board.sh <board.excalidraw> [out dir]}"
[ -f "$BOARD" ] || { echo "no such file: $BOARD" >&2; exit 2; }
NAME="$(basename "$BOARD" .excalidraw)"
OUT="${2:-measure-out/$NAME}"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
BOARD="$(cd "$(dirname "$BOARD")" && pwd)/$(basename "$BOARD")"

DATA="$(mktemp -d)"
trap 'stack_down; clear_dir "$DATA"' EXIT
cp "$BOARD" "$DATA/$NAME.excalidraw"

NODE=(docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp)

build_image
stack_up "$DATA"

"${NODE[@]}" --network host -v "$PWD/scripts":/s:ro -v "$OUT":/out -w /s node:22-alpine \
  node render-board.mjs "http://127.0.0.1:$PORT" "http://127.0.0.1:9222" "$NAME" /out

"${NODE[@]}" -v "$PWD/scripts":/s:ro -v "$(dirname "$BOARD")":/in:ro -w /s node:22-alpine \
  node board-outline.mjs "/in/$NAME.excalidraw" >"$OUT/outline.md"

echo
"${NODE[@]}" -v "$PWD/scripts":/s:ro -v "$(dirname "$BOARD")":/in:ro -v "$OUT":/out:ro -w /s node:22-alpine \
  node board-stats.mjs "/in/$NAME.excalidraw" /out/outline.md /out
echo
echo "outputs in $OUT"
