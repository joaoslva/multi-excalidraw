# multi-excalidraw

Self-hosted Excalidraw with many named boards, grouped into projects.

Boards are plain `.excalidraw` files in a folder you mount into the container. The folder is the whole database: a group is a directory, a board is a file. Back it up with git.

## Run

```
docker build -t multi-excalidraw .
docker run -d --name multi-excalidraw --restart unless-stopped \
  --read-only --user "$(id -u):$(id -g)" \
  -p 127.0.0.1:8411:8080 -v "$HOME/excalidraw-data:/data" multi-excalidraw
```

Open http://localhost:8411. The port is published on loopback only.

## Status

The app works end to end. Boards are grouped in a sidebar, open in the Excalidraw editor, and autosave to the data folder. A change made to the file elsewhere (an editor, git) is detected on the next save and offered as a choice instead of being overwritten.

Not built yet: renaming, moving and deleting boards and groups from the UI. The API and the store support them.

## Develop

Nothing runs on the host. Both halves are built and tested in containers:

```
docker run --rm -v "$PWD":/src -w /src/server golang:1.23 go test -race ./...
docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD/web":/app -w /app node:22-alpine npm test
```

`scripts/verify.sh` builds the image, runs it on a throwaway data folder, and drives it with a headless Chrome container: cold and warm load times, a check that no request leaves the machine, then creating a group and a board, drawing, reloading, and forcing a conflict. Set `SHOT_DIR` to a folder to get screenshots of failures.

`npm run build` fails when the JavaScript needed for first paint goes over 80 KB gzipped, or when the editor chunk leaks into it. That is what keeps the sidebar fast.

Excalidraw is pinned to an exact version and its fonts are copied into the image, so nothing is fetched from a CDN at runtime.
