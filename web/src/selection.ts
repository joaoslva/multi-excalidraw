import type { Ref } from "./types";

export type Op =
  | { kind: "renameBoard"; from: Ref; to: Ref }
  | { kind: "moveBoard"; from: Ref; to: Ref }
  | { kind: "deleteBoard"; ref: Ref }
  | { kind: "renameGroup"; from: string; to: string }
  | { kind: "deleteGroup"; name: string };

const same = (a: Ref, b: Ref) => a.group === b.group && a.name === b.name;

/** Returns `selected` itself (same object) when the operation does not touch it. */
export function selectionAfter(selected: Ref | null, op: Op): Ref | null {
  if (!selected) return selected;
  switch (op.kind) {
    case "renameBoard":
    case "moveBoard":
      return same(selected, op.from) ? op.to : selected;
    case "deleteBoard":
      return same(selected, op.ref) ? null : selected;
    case "renameGroup":
      return selected.group === op.from ? { group: op.to, name: selected.name } : selected;
    case "deleteGroup":
      return selected.group === op.name ? null : selected;
  }
}
