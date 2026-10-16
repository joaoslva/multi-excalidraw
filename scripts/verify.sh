#!/usr/bin/env bash
# Builds the image, runs it exactly as the README does on a throwaway data
# folder, and drives it with a headless Chrome container. Needs only Docker.
set -euo pipefail

cd "$(dirname "$0")/.."
PORT="${PORT:-18411}"
APP=mx-verify-app
CHROME=mx-verify-chrome
DATA="$(mktemp -d)"

cleanup() {
  docker rm -f "$APP" "$CHROME" >/dev/null 2>&1 || true
  # The app writes as the current user, so a plain container clears the folder safely.
  docker run --rm -v "$DATA":/d alpine sh -c 'rm -rf /d/* /d/.[!.]*' >/dev/null 2>&1 || true
  rmdir "$DATA" 2>/dev/null || true
}
trap cleanup EXIT

docker build -q -t multi-excalidraw . >/dev/null
docker image ls multi-excalidraw --format 'image size: {{.Size}}'

docker run -d --name "$APP" --read-only --user "$(id -u):$(id -g)" \
  -p "127.0.0.1:$PORT:8080" -v "$DATA":/data multi-excalidraw >/dev/null
docker run -d --name "$CHROME" --network host zenika/alpine-chrome:latest \
  --no-sandbox --disable-gpu --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 about:blank >/dev/null

for _ in $(seq 1 50); do
  curl -sf "http://127.0.0.1:9222/json/version" >/dev/null && curl -sf "http://127.0.0.1:$PORT/" >/dev/null && break
  sleep 0.2
done

# Set SHOT_DIR to an existing folder to get screenshots of failures.
SHOTS=()
[ -n "${SHOT_DIR:-}" ] && SHOTS=(-e SHOT_DIR=/shots -v "$SHOT_DIR":/shots)
docker run --rm --network host --user "$(id -u):$(id -g)" "${SHOTS[@]}" -v "$PWD/scripts":/s:ro -w /s node:22-alpine \
  node browser-check.mjs "http://127.0.0.1:$PORT" "http://127.0.0.1:9222"
