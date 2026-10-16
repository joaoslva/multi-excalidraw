import { afterEach, describe, expect, it } from "vitest";
import { clearActive, setActive, settleActive } from "./active";
import type { SaveStatus } from "./autosave";

afterEach(() => setActive(null));

function fake(after: SaveStatus) {
  let status: SaveStatus = { kind: "dirty" };
  return {
    flush: async () => {
      status = after;
    },
    status: () => status,
  };
}

describe("settleActive", () => {
  it("is true with no active editor", async () => {
    expect(await settleActive()).toBe(true);
  });

  it("is true when the flush ends saved", async () => {
    setActive(fake({ kind: "saved" }));
    expect(await settleActive()).toBe(true);
  });

  it.each<SaveStatus>([
    { kind: "conflict", current: "x" },
    { kind: "error", message: "boom", attempt: 1, retryInMs: 1000 },
    { kind: "gone" },
  ])("is false when the flush ends %o", async (after) => {
    setActive(fake(after));
    expect(await settleActive()).toBe(false);
  });
});

describe("clearActive", () => {
  it("does not clear an editor that registered after the one being unmounted", async () => {
    const a = fake({ kind: "saved" });
    const b = fake({ kind: "conflict", current: "x" });
    setActive(a);
    setActive(b);
    clearActive(a);
    expect(await settleActive()).toBe(false);
  });

  it("clears the editor that is still registered", async () => {
    const a = fake({ kind: "conflict", current: "x" });
    setActive(a);
    clearActive(a);
    expect(await settleActive()).toBe(true);
  });
});
