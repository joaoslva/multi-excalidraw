import { readFileSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";

const LIMIT = 80 * 1024;
const dist = new URL("../dist/", import.meta.url).pathname;
const html = readFileSync(join(dist, "index.html"), "utf8");

const js = html.match(/<script[^>]*type="module"[^>]*src="\/?([^"]+\.js)"/)?.[1];
if (!js) {
  console.error("check-size: no entry module script found in dist/index.html");
  process.exit(1);
}

const gz = (file) => gzipSync(readFileSync(join(dist, file))).length;
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

const jsSize = gz(js);
console.log(`entry JS  ${js}: ${kb(jsSize)} gzip (budget ${kb(LIMIT)})`);
for (const css of readdirSync(join(dist, "assets")).filter((f) => f.endsWith(".css"))) {
  console.log(`CSS       assets/${css}: ${kb(gz(`assets/${css}`))} gzip`);
}
if (jsSize > LIMIT) {
  console.error(`check-size: entry JS is ${kb(jsSize)} gzipped, over the ${kb(LIMIT)} budget`);
  process.exit(1);
}
