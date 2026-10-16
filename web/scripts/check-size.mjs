import { readFileSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";

const LIMIT = 80 * 1024;
const dist = new URL("../dist/", import.meta.url).pathname;
const html = readFileSync(join(dist, "index.html"), "utf8");

const fail = (msg) => {
  console.error(`check-size: ${msg}`);
  process.exit(1);
};

const scripts = [...html.matchAll(/<script[^>]*\ssrc="\/?([^"]+)"/g)].map((m) => m[1]);
const preloads = [...html.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="\/?([^"]+)"/g)].map((m) => m[1]);
const js = html.match(/<script[^>]*type="module"[^>]*src="\/?([^"]+\.js)"/)?.[1];
if (!js) fail("no entry module script found in dist/index.html");
if (scripts.length !== 1) fail(`index.html has ${scripts.length} scripts, expected only the entry: ${scripts.join(", ")}`);

const read = (file) => readFileSync(join(dist, file), "utf8");
const gz = (file) => gzipSync(readFileSync(join(dist, file))).length;
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

// Rollup hoists code shared by the entry and the lazy chunks (React, api.ts) into a chunk the entry
// imports statically; that one is first-paint by necessity. What must never be first-paint is a chunk
// the entry only reaches through import(), which is where Excalidraw lives.
const entrySrc = read(js);
const lazy = new Set([...entrySrc.matchAll(/import\("\.\/([^"]+\.js)"\)/g)].map((m) => `assets/${m[1]}`));
if (lazy.size === 0) fail(`entry ${js} has no dynamic import; is the editor still lazy?`);
const statics = new Set([...entrySrc.matchAll(/(?:from|import)\s*"\.\/([^"]+\.js)"/g)].map((m) => `assets/${m[1]}`));
for (const p of preloads) {
  if (lazy.has(p)) fail(`index.html preloads the lazy chunk ${p}`);
  if (!statics.has(p)) fail(`index.html preloads ${p}, which the entry does not import statically`);
}

const firstPaint = [js, ...preloads];
let total = 0;
for (const f of firstPaint) {
  const size = gz(f);
  total += size;
  console.log(`first-paint JS  ${f}: ${kb(size)} gzip`);
}
console.log(`first-paint JS  total: ${kb(total)} gzip (budget ${kb(LIMIT)})`);
for (const f of lazy) console.log(`lazy entry      ${f}: ${kb(gz(f))} gzip`);
for (const css of readdirSync(join(dist, "assets")).filter((f) => f.endsWith(".css"))) {
  console.log(`CSS             assets/${css}: ${kb(gz(`assets/${css}`))} gzip`);
}
const chunks = readdirSync(join(dist, "assets")).filter((f) => f.endsWith(".js"));
console.log(`all JS          ${chunks.length} chunks: ${kb(chunks.reduce((sum, f) => sum + gz(`assets/${f}`), 0))} gzip`);
if (total > LIMIT) fail(`first-paint JS is ${kb(total)} gzipped, over the ${kb(LIMIT)} budget`);
