#!/usr/bin/env bash
# Shared by verify.sh and measure-board.sh. Source it, then call stack_up and rely on
# stack_down in a trap. Needs only Docker.

PORT="${PORT:-18411}"
APP=mx-verify-app
CHROME=mx-verify-chrome

# build_image [force]: builds only when forced or when the image does not exist yet.
build_image() {
  if [ "${1:-}" = force ] || ! docker image inspect multi-excalidraw >/dev/null 2>&1; then
    docker build -q -t multi-excalidraw . >/dev/null
  fi
  docker image ls multi-excalidraw --format 'image size: {{.Size}}'
}

# stack_up <data dir>: runs the app exactly as the README does on that folder, plus a headless Chrome.
stack_up() {
  docker rm -f "$APP" "$CHROME" >/dev/null 2>&1 || true
  docker run -d --name "$APP" --read-only --user "$(id -u):$(id -g)" \
    -p "127.0.0.1:$PORT:8080" -v "$1":/data multi-excalidraw >/dev/null
  docker run -d --name "$CHROME" --network host zenika/alpine-chrome:latest \
    --no-sandbox --disable-gpu --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 about:blank >/dev/null
  for _ in $(seq 1 50); do
    curl -sf "http://127.0.0.1:9222/json/version" >/dev/null && curl -sf "http://127.0.0.1:$PORT/" >/dev/null && return 0
    sleep 0.2
  done
  echo "stack did not come up" >&2
  return 1
}

stack_down() {
  docker rm -f "$APP" "$CHROME" >/dev/null 2>&1 || true
}

# clear_dir <dir>: the app writes as the current user, so a plain container empties the folder safely.
clear_dir() {
  docker run --rm -v "$1":/d alpine sh -c 'rm -rf /d/* /d/.[!.]*' >/dev/null 2>&1 || true
  rmdir "$1" 2>/dev/null || true
}
