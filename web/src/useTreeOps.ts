import { useState } from "react";
import { settleActive } from "./active";
import { api, ApiError } from "./api";
import { selectionAfter, type Op } from "./selection";
import type { Ref, Tree } from "./types";

export const SETTLE_MESSAGE = "Resolve the save problem on the open board first.";

export const messageOf = (e: unknown) =>
  e instanceof ApiError ? e.message : `Request failed: ${e instanceof Error ? e.message : String(e)}`;

function call(op: Op): Promise<void> {
  switch (op.kind) {
    case "renameBoard":
    case "moveBoard":
      return api.moveBoard(op.from, op.to);
    case "deleteBoard":
      return api.deleteBoard(op.ref);
    case "renameGroup":
      return api.renameGroup(op.from, op.to);
    case "deleteGroup":
      return api.deleteGroup(op.name);
  }
}

/** The one place that sequences settle, API call, tree refresh and selection change. */
export function useTreeOps(selected: Ref | null, onTree: (t: Tree) => void, onSelect: (ref: Ref | null) => void) {
  const [error, setError] = useState<string | null>(null);

  const run = async (op: Op): Promise<boolean> => {
    const next = selectionAfter(selected, op);
    try {
      // selectionAfter returns the same object only when the open board is untouched.
      if (next !== selected && !(await settleActive())) {
        setError(SETTLE_MESSAGE);
        return false;
      }
      await call(op);
      onTree(await api.tree());
      setError(null);
      if (next !== selected) onSelect(next);
      return true;
    } catch (e) {
      setError(messageOf(e));
      return false;
    }
  };

  return { error, setError, run };
}
