import { ApiError, Conflict } from "./api";

export type SaveStatus =
  | { kind: "saved" }
  | { kind: "dirty" }
  | { kind: "saving" }
  /** current is the server's rev, which overwrite() saves against. */
  | { kind: "conflict"; current: string | null }
  /** The board was moved or deleted under us (404 on save); nothing more will be sent. */
  | { kind: "gone" }
  | { kind: "error"; message: string; attempt: number; retryInMs: number };

export interface AutosaveOptions {
  /** Resolves with the new rev; rejects with a 412 Conflict when rev is stale. */
  save: (json: string, rev: string) => Promise<string>;
  rev: string;
  version: number;
  debounceMs?: number;
  maxWaitMs?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
}

export interface Autosave {
  push(snapshot: () => string, version: number): void;
  flush(): Promise<void>;
  overwrite(): Promise<void>;
  status(): SaveStatus;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

type Timer = ReturnType<typeof setTimeout> | null;

export function createAutosave(o: AutosaveOptions): Autosave {
  const debounceMs = o.debounceMs ?? 800;
  const maxWaitMs = o.maxWaitMs ?? 5000;
  const retryBaseMs = o.retryBaseMs ?? 1000;
  const retryMaxMs = o.retryMaxMs ?? 30_000;

  let rev = o.rev;
  let latestVersion = o.version;
  let pending: (() => string) | null = null;
  let inFlight: Promise<void> | null = null;
  // A timer fired while a save was in flight; start the next one as soon as it lands.
  let due = false;
  let failures = 0;
  let disposed = false;
  let debounce: Timer = null;
  let maxWait: Timer = null;
  let retry: Timer = null;
  let current: SaveStatus = { kind: "saved" };
  const listeners = new Set<() => void>();

  const set = (s: SaveStatus) => {
    current = s;
    for (const l of listeners) l();
  };
  const stopped = () => current.kind === "conflict" || current.kind === "error" || current.kind === "gone";

  const clearTimers = () => {
    for (const t of [debounce, maxWait, retry]) if (t) clearTimeout(t);
    debounce = maxWait = retry = null;
  };

  const fire = () => {
    if (inFlight) due = true;
    else if (pending) start();
  };

  const start = () => {
    clearTimers();
    due = false;
    const snapshot = pending;
    if (!snapshot || disposed) return;
    pending = null;
    set({ kind: "saving" });
    inFlight = (async () => {
      let outcome: { ok: true; rev: string } | { ok: false; error: unknown };
      try {
        outcome = { ok: true, rev: await o.save(snapshot(), rev) };
      } catch (error) {
        outcome = { ok: false, error };
      }
      // Cleared before reacting, so a chained start() can install its own flight.
      inFlight = null;
      if (outcome.ok) {
        rev = outcome.rev;
        failures = 0;
        if (!pending) set({ kind: "saved" });
        else if (due) start();
        else set({ kind: "dirty" });
        return;
      }
      const e = outcome.error;
      // Never drop the scene: a failed snapshot stays queued unless a newer one replaced it.
      pending ??= snapshot;
      if (e instanceof Conflict && e.status === 412) {
        clearTimers();
        set({ kind: "conflict", current: e.current });
        return;
      }
      if (e instanceof ApiError && e.status === 404) {
        clearTimers();
        set({ kind: "gone" });
        return;
      }
      failures++;
      const retryInMs = Math.min(retryBaseMs * 2 ** (failures - 1), retryMaxMs);
      set({ kind: "error", message: e instanceof Error ? e.message : String(e), attempt: failures, retryInMs });
      if (!disposed) retry = setTimeout(start, retryInMs);
    })();
  };

  return {
    push(snapshot, version) {
      if (disposed || version === latestVersion) return;
      latestVersion = version;
      pending = snapshot;
      // Conflict waits for the user; error waits for its retry timer, which saves the latest snapshot.
      if (stopped()) return;
      if (!inFlight) set({ kind: "dirty" });
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(fire, debounceMs);
      maxWait ??= setTimeout(fire, maxWaitMs);
    },

    async flush() {
      for (;;) {
        if (stopped()) return;
        if (inFlight) await inFlight;
        else if (pending) start();
        else return;
      }
    },

    async overwrite() {
      if (current.kind !== "conflict") return;
      if (current.current !== null) rev = current.current;
      start();
      if (inFlight) await inFlight;
    },

    status: () => current,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    dispose() {
      disposed = true;
      clearTimers();
    },
  };
}
