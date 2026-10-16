import type { Ref } from "./types";

const PREFIX = "#/b/";

export function formatRoute(ref: Ref): string {
  return `${PREFIX}${encodeURIComponent(ref.group)}/${encodeURIComponent(ref.name)}`;
}

export function parseRoute(hash: string): Ref | null {
  if (!hash.startsWith(PREFIX)) return null;
  const parts = hash.slice(PREFIX.length).split("/");
  const [group, name] = parts;
  if (parts.length !== 2 || group === undefined || !name) return null;
  try {
    return { group: decodeURIComponent(group), name: decodeURIComponent(name) };
  } catch {
    return null;
  }
}
