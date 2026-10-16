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

describe("api moves and deletes", () => {
  const ok = () => fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

  it("moveBoard PATCHes the old address with the new one as JSON", async () => {
    ok();
    await api.moveBoard({ group: "a b", name: "x/y" }, { group: "", name: "z" });
    const { url, init } = lastCall();
    expect(url).toBe("/api/board?group=a+b&name=x%2Fy");
    expect(init.method).toBe("PATCH");
    expect(init.headers).toEqual({ "X-MX": "1", "Content-Type": "application/json" });
    expect(init.body).toBe('{"group":"","name":"z"}');
  });

  it("deleteBoard sends DELETE with X-MX only", async () => {
    ok();
    await api.deleteBoard({ group: "", name: "n&m" });
    const { url, init } = lastCall();
    expect(url).toBe("/api/board?group=&name=n%26m");
    expect(init.method).toBe("DELETE");
    expect(init.headers).toEqual({ "X-MX": "1" });
    expect(init.body).toBeUndefined();
  });

  it("renameGroup PATCHes the group with the new name as JSON", async () => {
    ok();
    await api.renameGroup("old g", "new");
    const { url, init } = lastCall();
    expect(url).toBe("/api/group?name=old+g");
    expect(init.method).toBe("PATCH");
    expect(init.headers).toEqual({ "X-MX": "1", "Content-Type": "application/json" });
    expect(init.body).toBe('{"name":"new"}');
  });

  it("deleteGroup sends DELETE with X-MX only", async () => {
    ok();
    await api.deleteGroup("g");
    const { url, init } = lastCall();
    expect(url).toBe("/api/group?name=g");
    expect(init.method).toBe("DELETE");
    expect(init.headers).toEqual({ "X-MX": "1" });
  });

  it("maps 409 to Conflict on every call", async () => {
    const calls = [
      () => api.moveBoard({ group: "", name: "a" }, { group: "g", name: "a" }),
      () => api.deleteBoard({ group: "", name: "a" }),
      () => api.renameGroup("a", "b"),
      () => api.deleteGroup("a"),
    ];
    for (const c of calls) {
      fetchMock.mockResolvedValueOnce(new Response("already exists", { status: 409 }));
      const e = await c().catch((x) => x);
      expect(e).toBeInstanceOf(Conflict);
      expect(e).toMatchObject({ status: 409, message: "already exists" });
    }
  });
});

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
    fetchMock.mockResolvedValue(new Response(null, { status: 204, headers: { ETag: '"r0"' } }));
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

  it("maps 412 to Conflict carrying the server's current rev, and 409 to none", async () => {
    fetchMock.mockResolvedValueOnce(new Response("revision conflict", { status: 412, headers: { ETag: '"9-42"' } }));
    const e412 = await api.saveBoard({ group: "g", name: "n" }, "{}", "1-1").catch((e) => e);
    expect(e412).toBeInstanceOf(Conflict);
    expect(e412.current).toBe("9-42");

    fetchMock.mockResolvedValueOnce(new Response("already exists", { status: 409 }));
    const e409 = await api.saveBoard({ group: "g", name: "n" }, "{}", "new").catch((e) => e);
    expect(e409).toBeInstanceOf(Conflict);
    expect(e409.current).toBeNull();
  });

  it("saveBoard with a rev sends a quoted If-Match and returns the new rev", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204, headers: { ETag: '"200-7"' } }));
    expect(await api.saveBoard({ group: "g h", name: "a&b" }, '{"type":"excalidraw"}', "100-5")).toBe("200-7");
    const { url, init } = lastCall();
    expect(url).toBe("/api/board?group=g+h&name=a%26b");
    expect(init.method).toBe("PUT");
    expect(init.headers).toEqual({ "If-Match": '"100-5"', "X-MX": "1", "Content-Type": "application/json" });
    expect(init.body).toBe('{"type":"excalidraw"}');
  });

  it("saveBoard rejects a success response that carries no ETag", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const err = await api.saveBoard({ group: "g", name: "n" }, "{}", "1-1").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe("response has no ETag");
  });

  it("saveBoard with new sends If-None-Match: *", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204, headers: { ETag: '"1-2"' } }));
    expect(await api.saveBoard({ group: "", name: "n" }, "{}", "new")).toBe("1-2");
    const { url, init } = lastCall();
    expect(url).toBe("/api/board?group=&name=n");
    expect(init.headers).toEqual({ "If-None-Match": "*", "X-MX": "1", "Content-Type": "application/json" });
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

describe("api.getBoard", () => {
  it("GETs the board with the preload's exact URL and trims the ETag quotes", async () => {
    fetchMock.mockResolvedValue(new Response('{"type":"excalidraw"}', { status: 200, headers: { ETag: '"123-45"' } }));
    expect(await api.getBoard({ group: "", name: "a/b c" })).toEqual({ json: '{"type":"excalidraw"}', rev: "123-45" });
    const { url, init } = lastCall();
    expect(url).toBe("/api/board?group=&name=a%2Fb+c");
    expect(init.method).toBe("GET");
    expect(init.headers).toEqual({});
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
