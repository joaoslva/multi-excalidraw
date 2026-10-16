// Prints how big each way of showing a board to an agent is, side by side.
// Usage: node board-stats.mjs <board.excalidraw> <outline.md> [image.png | folder of board-*.png ...]
// The token figures are estimates for comparing the three, not real counts: for a real
// count, paste each into a fresh Claude session and read the difference in /context.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const [boardFile, outlineFile, ...imageArgs] = process.argv.slice(2);
if (!boardFile || !outlineFile) {
  console.error("usage: node board-stats.mjs <board.excalidraw> <outline.md> [image.png ...]");
  process.exit(2);
}

const images = imageArgs.flatMap((p) =>
  statSync(p).isDirectory() ? readdirSync(p).filter((f) => /^board-.*\.png$/.test(f)).sort().map((f) => join(p, f)) : [p],
);

const CHARS_PER_TOKEN = 4;
const textTokens = (bytes) => Math.round(bytes / CHARS_PER_TOKEN);
// Images over about 1568 px on the long edge are scaled down before counting; tokens are roughly w*h/750.
const imageTokens = (w, h) => {
  const k = Math.min(1, 1568 / Math.max(w, h));
  return Math.round((w * k * (h * k)) / 750);
};
const pngSize = (file) => {
  const b = readFileSync(file);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), bytes: b.length };
};
const fmt = (n) => n.toLocaleString("en-US");

const raw = readFileSync(boardFile, "utf8");
const scene = JSON.parse(raw);
const live = scene.elements.filter((e) => !e.isDeleted);
const filesBytes = Buffer.byteLength(JSON.stringify(scene.files ?? {}));
const outlineBytes = statSync(outlineFile).size;

const rows = [
  ["Raw .excalidraw", statSync(boardFile).size, textTokens(statSync(boardFile).size), `${live.length} live of ${scene.elements.length} elements; embedded images: ${fmt(filesBytes)} bytes`],
  ["Raw without embedded images", statSync(boardFile).size - filesBytes, textTokens(statSync(boardFile).size - filesBytes), "what a careful agent would read"],
  ["Outline (markdown)", outlineBytes, textTokens(outlineBytes), outlineFile],
  ...images.map((f) => {
    const { width, height, bytes } = pngSize(f);
    return [`Image ${width}x${height}`, bytes, imageTokens(width, height), `file size, not tokens; ${f}`];
  }),
];

const pad = (s, n) => String(s).padEnd(n);
console.log(`${pad("Representation", 30)}${pad("Bytes", 12)}${pad("~Tokens", 10)}Notes`);
for (const [name, bytes, tokens, note] of rows) console.log(`${pad(name, 30)}${pad(fmt(bytes), 12)}${pad(fmt(tokens), 10)}${note}`);
console.log(`\nTokens are estimates (text: ${CHARS_PER_TOKEN} chars per token; images: w*h/750 after scaling to 1568 px). Real counts: /context in a fresh session.`);
