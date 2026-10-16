import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Conflict } from "./api";
import { createAutosave, type SaveStatus } from "./autosave";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** A save whose calls resolve only when the test says so. */
function controlledSave() {
  const calls: { json: string; rev: string; resolve: (rev: string) => void; reject: (e: unknown) => void }[] = [];
  const save = vi.fn(
    (json: string, rev: string) =>
      new Promise<string>((resolve, reject) => {
        calls.push({ json, rev, resolve, reject });
      }),
  );
  return { save, calls };
}

const snap = (s: string) => () => s;
const kind = (s: SaveStatus) => s.kind;
/** Let settled promises run their continuations. */
const settle = () => vi.advanceTimersByTimeAsync(0);

describe("autosave", () => {
  it("coalesces pushes within the debounce into one save of the last snapshot", async () => {
    const save = vi.fn(async () => "r2");
    const a = createAutosave({ save, rev: "r1", version: 1 });
    a.push(snap("A"), 2);
    await vi.advanceTimersByTimeAsync(500);
    a.push(snap("B"), 3);
    await vi.advanceTimersByTimeAsync(500);
    a.push(snap("C"), 4);
    expect(kind(a.status())).toBe("dirty");
    await vi.advanceTimersByTimeAsync(799);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save.mock.calls).toEqual([["C", "r1"]]);
    expect(kind(a.status())).toBe("saved");
  });

  it("saves within the max wait under a steady stream of pushes", async () => {
    const save = vi.fn(async () => "r2");
    const a = createAutosave({ save, rev: "r1", version: 0 });
    for (let v = 1; v <= 25; v++) {
      a.push(snap(`S${v}`), v);
      await vi.advanceTimersByTimeAsync(200);
    }
    // 25 pushes 200 ms apart: the debounce never elapses, the 5 s max wait fires once.
    expect(save.mock.calls).toEqual([["S25", "r1"]]);
  });

  it("saves a push made during an in-flight save after it, keeping only the latest", async () => {
    const { save, calls } = controlledSave();
    const a = createAutosave({ save, rev: "r1", version: 0 });
    a.push(snap("A"), 1);
    await vi.advanceTimersByTimeAsync(800);
    expect(kind(a.status())).toBe("saving");
    a.push(snap("B"), 2);
    a.push(snap("C"), 3);
    await vi.advanceTimersByTimeAsync(800);
    expect(save).toHaveBeenCalledTimes(1);
    calls[0]!.resolve("r2");
    await settle();
    expect(save.mock.calls).toEqual([
      ["A", "r1"],
      ["C", "r2"],
    ]);
    calls[1]!.resolve("r3");
    await settle();
    expect(kind(a.status())).toBe("saved");
  });

  it("skips a push whose version is unchanged", async () => {
    const save = vi.fn(async () => "r2");
    const a = createAutosave({ save, rev: "r1", version: 7 });
    a.push(snap("same"), 7);
    expect(kind(a.status())).toBe("saved");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(save).not.toHaveBeenCalled();
    a.push(snap("X"), 8);
    await vi.advanceTimersByTimeAsync(800);
    a.push(snap("X again"), 8);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(save.mock.calls).toEqual([["X", "r1"]]);
  });

  it("stops on a conflict and overwrite() saves the latest snapshot against the server's rev", async () => {
    const save = vi.fn<(json: string, rev: string) => Promise<string>>();
    save.mockRejectedValueOnce(new Conflict(412, "revision conflict", "theirs"));
    const a = createAutosave({ save, rev: "mine", version: 0 });
    a.push(snap("A"), 1);
    await vi.advanceTimersByTimeAsync(800);
    expect(a.status()).toEqual({ kind: "conflict", current: "theirs" });
    a.push(snap("B"), 2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(a.status()).toEqual({ kind: "conflict", current: "theirs" });

    save.mockResolvedValueOnce("r9");
    await a.overwrite();
    expect(save.mock.calls).toEqual([
      ["A", "mine"],
      ["B", "theirs"],
    ]);
    expect(a.status()).toEqual({ kind: "saved" });
  });

  it("keeps the snapshot on an error and retries with exponential backoff until it recovers", async () => {
    const save = vi.fn<(json: string, rev: string) => Promise<string>>();
    save.mockRejectedValueOnce(new Error("offline")).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce("r2");
    const a = createAutosave({ save, rev: "r1", version: 0 });
    a.push(snap("A"), 1);
    await vi.advanceTimersByTimeAsync(800);
    expect(a.status()).toEqual({ kind: "error", message: "offline", attempt: 1, retryInMs: 1000 });
    await vi.advanceTimersByTimeAsync(999);
    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(a.status()).toEqual({ kind: "error", message: "offline", attempt: 2, retryInMs: 2000 });
    await vi.advanceTimersByTimeAsync(2000);
    expect(save.mock.calls).toEqual([
      ["A", "r1"],
      ["A", "r1"],
      ["A", "r1"],
    ]);
    expect(a.status()).toEqual({ kind: "saved" });
  });

  it("caps the backoff and retries with the newest snapshot", async () => {
    const save = vi.fn<(json: string, rev: string) => Promise<string>>().mockRejectedValue(new Error("down"));
    const a = createAutosave({ save, rev: "r1", version: 0, retryMaxMs: 4000 });
    a.push(snap("A"), 1);
    await vi.advanceTimersByTimeAsync(800 + 1000 + 2000 + 4000);
    expect(a.status()).toMatchObject({ kind: "error", attempt: 4, retryInMs: 4000 });
    a.push(snap("B"), 2);
    save.mockResolvedValueOnce("r2");
    await vi.advanceTimersByTimeAsync(4000);
    expect(save.mock.calls.at(-1)).toEqual(["B", "r1"]);
    expect(a.status()).toEqual({ kind: "saved" });
  });

  it("flush resolves in every state", async () => {
    // saved: nothing to do
    const idle = createAutosave({ save: vi.fn(async () => "r"), rev: "r1", version: 0 });
    await idle.flush();
    expect(kind(idle.status())).toBe("saved");

    // dirty: saves now without waiting for the debounce
    const save = vi.fn(async () => "r2");
    const dirty = createAutosave({ save, rev: "r1", version: 0 });
    dirty.push(snap("A"), 1);
    await dirty.flush();
    expect(save.mock.calls).toEqual([["A", "r1"]]);
    expect(kind(dirty.status())).toBe("saved");

    // saving with a queued push: waits for both
    const c = controlledSave();
    const busy = createAutosave({ save: c.save, rev: "r1", version: 0 });
    busy.push(snap("A"), 1);
    await vi.advanceTimersByTimeAsync(800);
    busy.push(snap("B"), 2);
    let done = false;
    const f = busy.flush().then(() => (done = true));
    c.calls[0]!.resolve("r2");
    await settle();
    expect(done).toBe(false);
    c.calls[1]!.resolve("r3");
    await f;
    expect(c.save.mock.calls).toEqual([
      ["A", "r1"],
      ["B", "r2"],
    ]);

    // conflict and error: resolve without saving again
    for (const failure of [new Conflict(412, "stale", "x"), new Error("boom")]) {
      const s = vi.fn<(json: string, rev: string) => Promise<string>>().mockRejectedValue(failure);
      const a = createAutosave({ save: s, rev: "r1", version: 0 });
      a.push(snap("A"), 1);
      await a.flush();
      expect(s).toHaveBeenCalledTimes(1);
      expect(kind(a.status())).toBe(failure instanceof Conflict ? "conflict" : "error");
      a.dispose();
    }
  });

  it("serializes lazily: coalesced snapshots are never called", async () => {
    const save = vi.fn(async () => "r2");
    const a = createAutosave({ save, rev: "r1", version: 0 });
    const first = vi.fn(() => "A");
    const second = vi.fn(() => "B");
    a.push(first, 1);
    a.push(second, 2);
    expect(second).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(800);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("dispose stops scheduled saves", async () => {
    const save = vi.fn(async () => "r2");
    const a = createAutosave({ save, rev: "r1", version: 0 });
    a.push(snap("A"), 1);
    a.dispose();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(save).not.toHaveBeenCalled();
  });

  it("notifies subscribers of each status", async () => {
    const save = vi.fn(async () => "r2");
    const a = createAutosave({ save, rev: "r1", version: 0 });
    const seen: string[] = [];
    a.subscribe(() => seen.push(a.status().kind));
    a.push(snap("A"), 1);
    await vi.advanceTimersByTimeAsync(800);
    expect(seen).toEqual(["dirty", "saving", "saved"]);
  });
});
