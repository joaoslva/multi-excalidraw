#!/usr/bin/env bash
# Builds the image, runs it exactly as the README does on a throwaway data
# folder, and drives it with a headless Chrome container. Needs only Docker.
set -euo pipefail

cd "$(dirname "$0")/.."
. scripts/lib.sh
DATA="$(mktemp -d)"
trap 'stack_down; clear_dir "$DATA"' EXIT

build_image force
stack_up "$DATA"

# Set SHOT_DIR to an existing folder to get screenshots of failures.
SHOTS=()
[ -n "${SHOT_DIR:-}" ] && SHOTS=(-e SHOT_DIR=/shots -v "$SHOT_DIR":/shots)
docker run --rm --network host --user "$(id -u):$(id -g)" "${SHOTS[@]}" -v "$PWD/scripts":/s:ro -w /s node:22-alpine \
  node browser-check.mjs "http://127.0.0.1:$PORT" "http://127.0.0.1:9222"
