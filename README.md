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

Under construction. The Dockerfile and the app do not exist yet.
