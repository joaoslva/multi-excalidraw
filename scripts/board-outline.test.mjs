import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { outline } from "./board-outline.mjs";

const sample = () => JSON.parse(readFileSync(new URL("./fixtures/sample.excalidraw", import.meta.url), "utf8"));
const lines = () => outline(sample(), "sample").split("\n");

const box = (id, x, y, extra = {}) => ({ id, type: "rectangle", x, y, width: 100, height: 50, isDeleted: false, groupIds: [], ...extra });
const label = (id, containerId, text) => ({ id, type: "text", x: 0, y: 0, width: 10, height: 10, isDeleted: false, text, containerId });

test("summary line has extent, counts by type and deleted count", () => {
  assert.ok(
    lines().includes("Canvas 1000 x 480 px. 19 elements: 1 frame, 5 rectangle, 1 diamond, 3 arrow, 7 text, 1 freedraw, 1 image. 2 deleted ignored."),
  );
});

test("bound arrow connects labelled nodes", () => {
  assert.ok(lines().includes("- Upload -> Parse"));
});

test("arrow label is quoted after the connection", () => {
  assert.ok(lines().includes('- Parse -> valid? "rows"'));
});

test("unbound start near a node is guessed with ~", () => {
  assert.ok(lines().includes("- valid?~ -> Store"));
});

test("unbound end with nothing near is a loose end with its region", () => {
  const scene = {
    elements: [
      box("a", 0, 0, { boundElements: [] }),
      label("la", "a", "A"),
      { id: "ar", type: "arrow", x: 100, y: 25, width: 400, height: 0, isDeleted: false, points: [[0, 0], [400, 0]], startBinding: { elementId: "a" }, endBinding: null, startArrowhead: null, endArrowhead: "arrow" },
    ],
  };
  assert.ok(outline(scene, "t").split("\n").includes("- A -> (loose end at right)"));
});

test("plain line and double-headed arrow use -- and <->", () => {
  const scene = {
    elements: [
      box("a", 0, 0),
      box("b", 300, 0),
      { id: "l", type: "line", x: 50, y: 25, width: 300, height: 0, isDeleted: false, points: [[0, 0], [300, 0]], startBinding: { elementId: "a" }, endBinding: { elementId: "b" } },
      { id: "d", type: "arrow", x: 50, y: 25, width: 300, height: 0, isDeleted: false, points: [[0, 0], [300, 0]], startBinding: { elementId: "a" }, endBinding: { elementId: "b" }, startArrowhead: "arrow", endArrowhead: "arrow" },
    ],
  };
  const out = outline(scene, "t").split("\n");
  assert.ok(out.includes("- n1 -- n2"));
  assert.ok(out.includes("- n1 <-> n2"));
});

test("link shows on the node that carries it", () => {
  assert.ok(lines().includes("- Store (n6): box, center, link https://example.com/docs/storage"));
});

test("grouped boxes share a group number and unlabelled ones use n refs", () => {
  const out = lines();
  assert.ok(out.includes("- n4: box, top-right, group 1"));
  assert.ok(out.includes("- n5: box, right, group 1"));
});

test("frame lists what sits inside it by frameId", () => {
  assert.ok(lines().includes("- Ingest pipeline: center, 760 x 300 px at (40, 40); contains valid?, Upload, Parse, Store"));
});

test("multi-line note is joined with ' / '", () => {
  assert.ok(lines().includes('- "TODO: / retry on failure / add metrics": bottom-left'));
});

test("freehand and image are listed as needing a picture", () => {
  const out = lines();
  const at = out.indexOf("## Needs a picture");
  assert.ok(at >= 0);
  assert.deepEqual(out.slice(at + 4, at + 6), [
    "- freehand sketch: 120 x 60 px, bottom",
    "- image img1: 100 x 80 px, bottom-right",
  ]);
});

test("deleted elements do not appear", () => {
  assert.ok(!outline(sample(), "sample").includes("old idea"));
});

test("output is deterministic", () => {
  assert.equal(outline(sample(), "sample"), outline(sample(), "sample"));
});

test("empty scene gives a short outline", () => {
  assert.equal(outline({ elements: [] }, "blank"), "# blank\n\nEmpty board. 0 elements, 0 deleted ignored.\n");
});
