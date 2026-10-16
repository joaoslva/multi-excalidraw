import { describe, expect, it } from "vitest";
import { formatRoute, parseRoute } from "./route";

const names = ["plain", "with space", "çãé 日本語", "a/b", "100%", "a#b", "what?", "a&b=c", "%2F", "../x"];

describe("route", () => {
  for (const group of ["", ...names]) {
    for (const name of names) {
      it(`round-trips ${JSON.stringify([group, name])}`, () => {
        expect(parseRoute(formatRoute({ group, name }))).toEqual({ group, name });
      });
    }
  }

  it("keeps an empty group empty in the hash", () => {
    expect(formatRoute({ group: "", name: "x y" })).toBe("#/b//x%20y");
  });

  it("encodes slashes so the route keeps exactly two segments", () => {
    expect(formatRoute({ group: "a/b", name: "c" })).toBe("#/b/a%2Fb/c");
  });

  it("rejects non-board hashes", () => {
    expect(parseRoute("")).toBeNull();
    expect(parseRoute("#/other/x/y")).toBeNull();
    expect(parseRoute("#/b/onlyone")).toBeNull();
    expect(parseRoute("#/b/g/")).toBeNull();
    expect(parseRoute("#/b/g/n/extra")).toBeNull();
    expect(parseRoute("#/b/%E0%A4%A/n")).toBeNull();
  });
});
