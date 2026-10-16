import { cpSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Vite does not bundle Excalidraw's fonts; main.tsx points EXCALIDRAW_ASSET_PATH here so no CDN is used.
const from = fileURLToPath(new URL("../node_modules/@excalidraw/excalidraw/dist/prod/fonts/", import.meta.url));
const to = fileURLToPath(new URL("../dist/excalidraw/fonts/", import.meta.url));
cpSync(from, to, { recursive: true });
const count = readdirSync(to, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).length;
console.log(`copy-fonts: ${count} files to dist/excalidraw/fonts/`);
