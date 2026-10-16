import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, Conflict, parseTree } from "./api";

const fetchMock = vi.fn();
beforeEach(() => vi.stubGlobal("fetch", fetchMock));
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

const lastCall = () => {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return { url, init };
};

describe("api writes", () => {
  it("createGroup sends PUT with X-MX and JSON content type", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await api.createGroup("my group&x");
    const { url, init } = lastCall();
    expect(url).toBe("/api/group?name=my+group%26x");
    expect(init.method).toBe("PUT");
    expect(init.headers).toEqual({ "X-MX": "1", "Content-Type": "application/json" });
    expect(init.body).toBeUndefined();
  });

  it("createBoard sends If-None-Match and an empty scene", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await api.createBoard({ group: "", name: "a/b" });
    const { url, init } = lastCall();
    expect(url).toBe("/api/board?group=&name=a%2Fb");
    expect(init.method).toBe("PUT");
    expect(init.headers).toEqual({ "If-None-Match": "*", "X-MX": "1", "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({
      type: "excalidraw",
      version: 2,
      source: "multi-excalidraw",
      elements: [],
      appState: {},
      files: {},
    });
  });

  it("maps 409 and 412 to Conflict carrying the status and server text", async () => {
    fetchMock.mockResolvedValueOnce(new Response("already exists\n", { status: 409 }));
    const e409 = await api.createGroup("g").catch((e) => e);
    expect(e409).toBeInstanceOf(Conflict);
    expect(e409).toMatchObject({ status: 409, message: "already exists" });

    fetchMock.mockResolvedValueOnce(new Response("revision conflict", { status: 412 }));
    const e412 = await api.createBoard({ group: "", name: "n" }).catch((e) => e);
    expect(e412).toBeInstanceOf(Conflict);
    expect(e412.status).toBe(412);
  });

  it("maps other failures to a plain ApiError", async () => {
    fetchMock.mockResolvedValue(new Response("invalid name", { status: 400 }));
    const e = await api.createGroup("..").catch((e) => e);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).not.toBeInstanceOf(Conflict);
    expect(e).toMatchObject({ status: 400, message: "invalid name" });
  });

  it("setLast PUTs the ref, or null", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await api.setLast({ group: "g", name: "n" });
    expect(lastCall().url).toBe("/api/last");
    expect(lastCall().init.body).toBe('{"group":"g","name":"n"}');
    fetchMock.mockClear();
    await api.setLast(null);
    expect(lastCall().init.body).toBe("null");
  });
});

describe("api.tree", () => {
  it("GETs without X-MX and parses the tree", async () => {
    const body = { groups: [], ungrouped: [{ name: "a", rev: "r1" }], last: null };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    expect(await api.tree()).toEqual(body);
    const { url, init } = lastCall();
    expect(url).toBe("/api/tree");
    expect(init.method).toBe("GET");
    expect(init.headers).toEqual({});
  });
});

describe("parseTree", () => {
  const good = {
    groups: [{ name: "g", boards: [{ name: "b", rev: "r" }] }],
    ungrouped: [],
    last: { group: "g", name: "b" },
  };

  it("accepts a good tree", () => {
    expect(parseTree(good)).toEqual(good);
  });

  it("rejects a missing field", () => {
    expect(() => parseTree({ groups: [], last: null })).toThrow("tree.ungrouped: expected array");
    expect(() => parseTree({ groups: [], ungrouped: [] })).toThrow("tree.last: missing");
  });

  it("rejects wrong types with a path", () => {
    expect(() => parseTree({ ...good, groups: [{ name: "g", boards: [{ name: 1, rev: "r" }] }] })).toThrow(
      "tree.groups[0].boards[0].name: expected string",
    );
    expect(() => parseTree("nope")).toThrow("tree: expected object");
  });
});
