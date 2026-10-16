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

Under construction. The server, the Docker image and the sidebar work: you can create groups and boards and switch between them, and the sidebar is rendered from data inlined into the page, so it needs no request. The board itself is still a placeholder; the Excalidraw editor comes next.

## Develop

Nothing runs on the host. Both halves are built and tested in containers:

```
docker run --rm -v "$PWD":/src -w /src/server golang:1.23 go test -race ./...
docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD/web":/app -w /app node:22-alpine npm test
```

`npm run build` fails when the entry JavaScript goes over 80 KB gzipped, which keeps the sidebar fast.
