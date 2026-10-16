// Renders one board to PNG files in a real Chrome over the DevTools protocol, no dependencies.
// Run it through measure-board.sh. Usage:
//   node render-board.mjs <app base url> <chrome debugging url> <board name> <out dir> [WxH ...]

import { writeFileSync } from "node:fs";

const [BASE, CDP, NAME, OUT, ...sizeArgs] = process.argv.slice(2);
if (!BASE || !CDP || !NAME || !OUT) {
  console.error("usage: node render-board.mjs <base url> <chrome url> <board name> <out dir> [WxH ...]");
  process.exit(2);
}
const SIZES = (sizeArgs.length ? sizeArgs : ["1600x1000", "1024x640"]).map((s) => s.split("x").map(Number));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const target = await (await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});
let nextId = 1;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (!msg.id) return;
  const p = pending.get(msg.id);
  pending.delete(msg.id);
  msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "evaluate failed");
  return r.result.value;
};
const waitFor = async (expression, ms = 20000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const v = await evaluate(expression);
      if (v) return v;
    } catch {}
    await sleep(50);
  }
  return null;
};

await send("Page.enable");
await send("Runtime.enable");

for (const [width, height] of SIZES) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: "about:blank" });
  await send("Page.navigate", { url: `${BASE}/#/b//${encodeURIComponent(NAME)}` });
  if (!(await waitFor(`!!document.querySelector(".excalidraw canvas")`))) throw new Error("the board did not open");
  // Overlays out of the way, then Excalidraw's own "zoom to fit all" (Shift+1). The shortcut only
  // reaches it with the pointer over the canvas and the event dispatched on its own element.
  await evaluate(`(() => { const s = document.createElement("style"); s.textContent = ".layer-ui__wrapper, nav.sidebar, .save-chip, .conflict-banner, .welcome-screen-center { display: none !important }"; document.head.append(s); })()`);
  await sleep(300);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: Math.round(width / 2), y: Math.round(height / 2) });
  await evaluate(`document.querySelector(".excalidraw").dispatchEvent(new KeyboardEvent("keydown", { key: "!", code: "Digit1", shiftKey: true, bubbles: true, cancelable: true }))`);
  await sleep(1500);
  const r = JSON.parse(await evaluate(`JSON.stringify(document.querySelector(".excalidraw").getBoundingClientRect())`));
  const { data } = await send("Page.captureScreenshot", { format: "png", clip: { x: r.x, y: r.y, width: r.width, height: r.height, scale: 1 } });
  const file = `${OUT}/board-${width}x${height}.png`;
  writeFileSync(file, Buffer.from(data, "base64"));
  console.log(`wrote ${file}`);
}
ws.close();
