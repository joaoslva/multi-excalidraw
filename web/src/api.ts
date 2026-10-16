import type { BoardEntry, GroupEntry, Ref, Tree } from "./types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** 409 (already exists) and 412 (stale revision). */
export class Conflict extends ApiError {
  constructor(status: number, message: string) {
    super(status, message);
    this.name = "Conflict";
  }
}

const EMPTY_SCENE = JSON.stringify({
  type: "excalidraw",
  version: 2,
  source: "multi-excalidraw",
  elements: [],
  appState: {},
  files: {},
});

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(o: Record<string, unknown>, key: string, where: string): string {
  const v = o[key];
  if (typeof v !== "string") throw new Error(`${where}.${key}: expected string`);
  return v;
}

function list(o: Record<string, unknown>, key: string, where: string): unknown[] {
  const v = o[key];
  if (!Array.isArray(v)) throw new Error(`${where}.${key}: expected array`);
  return v;
}

function parseBoard(v: unknown, where: string): BoardEntry {
  if (!isObj(v)) throw new Error(`${where}: expected object`);
  return { name: str(v, "name", where), rev: str(v, "rev", where) };
}

function parseRef(v: unknown, where: string): Ref {
  if (!isObj(v)) throw new Error(`${where}: expected object`);
  return { group: str(v, "group", where), name: str(v, "name", where) };
}

export function parseTree(v: unknown): Tree {
  if (!isObj(v)) throw new Error("tree: expected object");
  const groups: GroupEntry[] = list(v, "groups", "tree").map((g, i) => {
    const where = `tree.groups[${i}]`;
    if (!isObj(g)) throw new Error(`${where}: expected object`);
    return {
      name: str(g, "name", where),
      boards: list(g, "boards", where).map((b, j) => parseBoard(b, `${where}.boards[${j}]`)),
    };
  });
  const ungrouped = list(v, "ungrouped", "tree").map((b, i) => parseBoard(b, `tree.ungrouped[${i}]`));
  if (!("last" in v)) throw new Error("tree.last: missing");
  const last = v.last === null ? null : parseRef(v.last, "tree.last");
  return { groups, ungrouped, last };
}

async function request(method: string, path: string, query: Record<string, string>, init: { headers?: Record<string, string>; body?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = { ...init.headers };
  if (method !== "GET") headers["X-MX"] = "1";
  if (method === "PUT" || method === "PATCH") headers["Content-Type"] = "application/json";
  const qs = new URLSearchParams(query).toString();
  const res = await fetch(qs ? `${path}?${qs}` : path, { method, headers, body: init.body });
  if (res.ok) return res;
  const text = (await res.text().catch(() => "")).trim() || res.statusText || `HTTP ${res.status}`;
  throw res.status === 409 || res.status === 412 ? new Conflict(res.status, text) : new ApiError(res.status, text);
}

export const api = {
  async tree(): Promise<Tree> {
    const res = await request("GET", "/api/tree", {});
    return parseTree(await res.json());
  },

  async createGroup(name: string): Promise<void> {
    await request("PUT", "/api/group", { name });
  },

  async createBoard(ref: Ref): Promise<void> {
    await request("PUT", "/api/board", { group: ref.group, name: ref.name }, { headers: { "If-None-Match": "*" }, body: EMPTY_SCENE });
  },

  async setLast(ref: Ref | null): Promise<void> {
    await request("PUT", "/api/last", {}, { body: JSON.stringify(ref) });
  },
};
