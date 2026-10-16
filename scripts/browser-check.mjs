// End-to-end check in a real Chrome over the DevTools protocol, no dependencies.
// Run it through scripts/verify.sh, which starts the app and Chrome in containers.
// Usage: node browser-check.mjs <app base url> <chrome debugging url>

const BASE = process.argv[2] ?? "http://127.0.0.1:8411";
const CDP = process.argv[3] ?? "http://127.0.0.1:9222";
const WARM_BOARD_BUDGET_MS = 1000;

import { writeFileSync } from "node:fs";

const SHOT_DIR = process.env.SHOT_DIR;
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const api = async (method, path, { headers = {}, body } = {}) => {
  const h = { ...headers };
  if (method !== "GET") h["X-MX"] = "1";
  if (method === "PUT" || method === "PATCH") h["Content-Type"] = "application/json";
  const res = await fetch(BASE + path, { method, headers: h, body });
  return { status: res.status, etag: res.headers.get("etag"), text: await res.text() };
};

const target = await (await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});
let nextId = 1;
const pending = new Map();
const requests = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? p.reject(new Error(`${msg.error.message}`)) : p.resolve(msg.result);
  } else if (msg.method === "Network.requestWillBeSent") {
    requests.push(msg.params.request.url);
  }
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
const waitFor = async (expression, ms = 10000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const v = await evaluate(expression);
      if (v) return v;
    } catch {}
    await sleep(40);
  }
  return null;
};

const shot = async (name) => {
  if (!SHOT_DIR) return;
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${SHOT_DIR}/${name}.png`, Buffer.from(data, "base64"));
};
const chip = () => evaluate(`document.querySelector(".save-chip")?.textContent ?? null`);

await send("Page.enable");
await send("Runtime.enable");
await send("Network.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
    window.__marks = {};
    const mark = (k) => { if (!(k in window.__marks)) window.__marks[k] = performance.now(); };
    new MutationObserver(() => {
      if (document.querySelector("nav.sidebar a")) mark("sidebar");
      if (document.querySelector(".excalidraw canvas")) mark("canvas");
    }).observe(document, { childList: true, subtree: true });
  `,
});

const marks = async () => {
  const m = await evaluate(`JSON.stringify({ ...window.__marks, fcp: performance.getEntriesByName("first-contentful-paint")[0]?.startTime })`);
  return JSON.parse(m);
};
const ms = (n) => (n === undefined ? "n/a" : `${Math.round(n)} ms`);
const goto = async (url) => {
  await send("Page.navigate", { url });
  await waitFor(`document.readyState === "complete"`, 15000);
};
const clickText = (selector, text) =>
  evaluate(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((b) => b.textContent.trim() === ${JSON.stringify(text)}); if (!el) return false; el.click(); return true; })()`);
const typeAndEnter = async (text) => {
  await send("Input.insertText", { text });
  for (const type of ["keyDown", "keyUp"]) {
    await send("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: type === "keyDown" ? "\r" : undefined });
  }
};
const drawRectangle = async (dx, dy) => {
  await evaluate(`document.querySelector('[data-testid="toolbar-rectangle"]').click()`);
  const r = JSON.parse(await evaluate(`JSON.stringify(document.querySelector(".excalidraw canvas.interactive, .excalidraw canvas").getBoundingClientRect())`));
  const x = r.x + dx;
  const y = r.y + dy;
  const mouse = (type, px, py) => send("Input.dispatchMouseEvent", { type, x: px, y: py, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1 });
  await mouse("mousePressed", x, y);
  for (let i = 1; i <= 8; i++) await mouse("mouseMoved", x + i * 20, y + i * 12);
  await mouse("mouseReleased", x + 160, y + 96);
};
const sceneOnServer = async (group, name) => {
  const res = await api("GET", `/api/board?${new URLSearchParams({ group, name })}`);
  return res.status === 200 ? { etag: res.etag, scene: JSON.parse(res.text) } : null;
};
const liveElements = (s) => s.scene.elements.filter((e) => !e.isDeleted).length;

// 1. Cold and warm load of an existing board.
const seed = { type: "excalidraw", version: 2, source: "browser-check", elements: [], appState: {}, files: {} };
await api("PUT", "/api/group?name=Perf");
await api("PUT", "/api/board?" + new URLSearchParams({ group: "Perf", name: "Seed" }), { headers: { "If-None-Match": "*" }, body: JSON.stringify(seed) });
await api("PUT", "/api/last", { body: JSON.stringify({ group: "Perf", name: "Seed" }) });

await send("Network.setCacheDisabled", { cacheDisabled: true });
await goto(BASE + "/");
await waitFor(`!!window.__marks.canvas`, 20000);
const cold = await marks();
console.log(`cold load  sidebar ${ms(cold.sidebar)}  first paint ${ms(cold.fcp)}  editor canvas ${ms(cold.canvas)}`);
check("cold load shows the sidebar and the editor", cold.sidebar !== undefined && cold.canvas !== undefined);

await send("Network.setCacheDisabled", { cacheDisabled: false });
await goto(BASE + "/");
await waitFor(`!!window.__marks.canvas`, 20000);
const warm = await marks();
console.log(`warm load  sidebar ${ms(warm.sidebar)}  first paint ${ms(warm.fcp)}  editor canvas ${ms(warm.canvas)}`);
check(`warm load shows the editor within ${WARM_BOARD_BUDGET_MS} ms`, warm.canvas !== undefined && warm.canvas < WARM_BOARD_BUDGET_MS, ms(warm.canvas));
check("sidebar appears before the editor", warm.sidebar !== undefined && warm.sidebar < warm.canvas, `${ms(warm.sidebar)} < ${ms(warm.canvas)}`);

const foreign = [...new Set(requests.map((u) => new URL(u).host))].filter((h) => h && !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(h));
check("no request leaves the machine", foreign.length === 0, foreign.join(", ") || `${requests.length} requests, all local`);

// 2. Create a group and a board through the UI, draw, and see it saved.
await goto(BASE + "/#/b/Perf/Seed");
await waitFor(`!!document.querySelector("nav.sidebar")`);
check("New group", await clickText("button", "New group"));
await sleep(100);
await typeAndEnter("Work");
check("group appears in the sidebar", !!(await waitFor(`[...document.querySelectorAll("nav.sidebar h2")].some((h) => h.textContent === "Work")`)));
check("New board in the group", await evaluate(`(() => { const b = document.querySelector('button[aria-label="New board in Work"]'); if (!b) return false; b.click(); return true; })()`));
await sleep(100);
await typeAndEnter("Plan");
check("new board opens", !!(await waitFor(`location.hash === "#/b/Work/Plan" && !!document.querySelector(".excalidraw canvas")`, 15000)));
check("new board exists on the server", (await sceneOnServer("Work", "Plan")) !== null);

const before = await sceneOnServer("Work", "Plan");
await sleep(1500);
const afterIdle = await sceneOnServer("Work", "Plan");
check("opening a board does not write it", before.etag === afterIdle.etag);

await drawRectangle(400, 200);
let saved = null;
for (let i = 0; i < 40 && !saved; i++) {
  await sleep(250);
  const s = await sceneOnServer("Work", "Plan");
  if (s && liveElements(s) === 1) saved = s;
}
check("a drawn rectangle is autosaved to the data folder", !!saved, saved ? `rev ${saved.etag}` : `not saved within 10 s, chip says ${JSON.stringify(await chip())}`);
if (!saved) await shot("draw-not-saved");
check("the status chip reads Saved", !!(await waitFor(`document.querySelector(".save-chip")?.textContent === "Saved"`, 5000)));

await goto(BASE + "/#/b/Work/Plan");
await waitFor(`!!document.querySelector(".excalidraw canvas")`, 15000);
await sleep(1500);
const reloaded = await sceneOnServer("Work", "Plan");
check("reloading keeps the drawing and does not rewrite it", reloaded && saved && reloaded.etag === saved.etag && liveElements(reloaded) === 1);

// 3. Edit the file behind the app's back, then edit in the page: expect a conflict.
const external = structuredClone(saved.scene);
external.elements.push({ ...external.elements[0], id: "external-" + Date.now(), x: 900, y: 50, version: 99, versionNonce: 7 });
const put = await api("PUT", "/api/board?" + new URLSearchParams({ group: "Work", name: "Plan" }), { headers: { "If-Match": saved.etag }, body: JSON.stringify(external) });
check("external edit accepted", put.status === 204, `status ${put.status}`);
await drawRectangle(400, 420);
check("a stale save shows the conflict banner", !!(await waitFor(`/changed elsewhere/i.test(document.body.innerText)`, 15000)));
const stillExternal = await sceneOnServer("Work", "Plan");
check("the conflicting save did not overwrite the file", liveElements(stillExternal) === 2, `${liveElements(stillExternal)} elements on disk`);
check("Overwrite", await clickText("button", "Overwrite"));
let overwritten = null;
for (let i = 0; i < 40 && !overwritten; i++) {
  await sleep(250);
  const s = await sceneOnServer("Work", "Plan");
  if (s && s.etag !== stillExternal.etag) overwritten = s;
}
check("Overwrite saves the page's version", !!overwritten && liveElements(overwritten) === 2, overwritten ? `${liveElements(overwritten)} elements` : "no write");
check("the banner goes away", !!(await waitFor(`!/changed elsewhere/i.test(document.body.innerText)`, 5000)));

ws.close();
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\n${failed.length} of ${results.length} checks FAILED` : `\nall ${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
