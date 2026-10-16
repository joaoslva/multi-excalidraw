import type { Autosave } from "./autosave";

type Active = Pick<Autosave, "flush" | "status">;

let active: Active | null = null;

export function setActive(a: Active | null): void {
  active = a;
}

/** Unmounting editor A must not clear editor B that already registered. */
export function clearActive(a: Active): void {
  if (active === a) active = null;
}

/** True when nothing is unsaved or failing: safe to move, rename or delete the open board. */
export async function settleActive(): Promise<boolean> {
  if (!active) return true;
  await active.flush();
  return active?.status().kind === "saved";
}
