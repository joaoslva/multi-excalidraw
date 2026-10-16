import { describe, expect, it } from "vitest";
import { selectionAfter, type Op } from "./selection";
import type { Ref } from "./types";

const sel: Ref = { group: "G", name: "a" };
const ung: Ref = { group: "", name: "a" };

describe("selectionAfter", () => {
  const changed: [string, Ref, Op, Ref | null][] = [
    ["rename of the selected board", sel, { kind: "renameBoard", from: sel, to: { group: "G", name: "b" } }, { group: "G", name: "b" }],
    ["rename of an Ungrouped selected board", ung, { kind: "renameBoard", from: ung, to: { group: "", name: "c" } }, { group: "", name: "c" }],
    ["move of the selected board", sel, { kind: "moveBoard", from: sel, to: { group: "", name: "a" } }, { group: "", name: "a" }],
    ["move from Ungrouped into a group", ung, { kind: "moveBoard", from: ung, to: { group: "H", name: "a" } }, { group: "H", name: "a" }],
    ["group rename", sel, { kind: "renameGroup", from: "G", to: "H" }, { group: "H", name: "a" }],
    ["delete of the selected board", sel, { kind: "deleteBoard", ref: sel }, null],
    ["delete of the selected Ungrouped board", ung, { kind: "deleteBoard", ref: ung }, null],
    ["delete of its group", sel, { kind: "deleteGroup", name: "G" }, null],
  ];
  it.each(changed)("%s", (_, selected, op, expected) => {
    expect(selectionAfter(selected, op)).toEqual(expected);
  });

  const unchanged: [string, Op][] = [
    ["same board name in another group", { kind: "renameBoard", from: { group: "H", name: "a" }, to: { group: "H", name: "z" } }],
    ["same name moved from another group", { kind: "moveBoard", from: { group: "", name: "a" }, to: { group: "H", name: "a" } }],
    ["delete of same name elsewhere", { kind: "deleteBoard", ref: { group: "H", name: "a" } }],
    ["case-differing board name", { kind: "renameBoard", from: { group: "G", name: "A" }, to: { group: "G", name: "z" } }],
    ["case-differing group rename", { kind: "renameGroup", from: "g", to: "H" }],
    ["case-differing group delete", { kind: "deleteGroup", name: "g" }],
    ["other group rename", { kind: "renameGroup", from: "H", to: "I" }],
    ["other group delete", { kind: "deleteGroup", name: "H" }],
  ];
  it.each(unchanged)("leaves the selection alone: %s", (_, op) => {
    expect(selectionAfter(sel, op)).toBe(sel);
  });

  it("does not match the Ungrouped group against a named one", () => {
    expect(selectionAfter(ung, { kind: "renameGroup", from: "G", to: "H" })).toBe(ung);
    expect(selectionAfter(ung, { kind: "deleteGroup", name: "G" })).toBe(ung);
  });

  it("returns null for no selection", () => {
    expect(selectionAfter(null, { kind: "deleteGroup", name: "G" })).toBeNull();
  });
});
