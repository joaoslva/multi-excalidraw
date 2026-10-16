import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { formatRoute, parseRoute } from "./route";
import { Sidebar } from "./Sidebar";
import type { Ref, Tree } from "./types";

const loadEditor = () => import("./Editor");
const Editor = lazy(loadEditor);

export function App({ initial }: { initial: Tree }) {
  const [tree, setTree] = useState(initial);
  const [selected, setSelected] = useState<Ref | null>(() => {
    const ref = parseRoute(location.hash) ?? (location.hash ? null : initial.last);
    // Start the chunk download now so it overlaps the scene fetch the server preloaded.
    if (ref) void loadEditor();
    return ref;
  });

  useEffect(() => {
    const onHash = () => setSelected(parseRoute(location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Keep the address bar in step when the selection came from tree.last.
  useEffect(() => {
    if (selected && !location.hash) history.replaceState(null, "", formatRoute(selected));
  }, [selected]);

  const group = selected?.group;
  const name = selected?.name;
  useEffect(() => {
    if (group !== undefined && name !== undefined) api.setLast({ group, name }).catch(() => {});
  }, [group, name]);

  const open = useCallback((ref: Ref) => {
    location.hash = formatRoute(ref);
  }, []);

  return (
    <div className="shell">
      <Sidebar tree={tree} selected={selected} onTree={setTree} onOpen={open} />
      {selected ? (
        <main className="main main-editor">
          <Suspense fallback={<Skeleton board={selected} />}>
            <Editor key={`${selected.group}/${selected.name}`} board={selected} />
          </Suspense>
        </main>
      ) : (
        <main className="main">
          <p className="empty">Select a board, or create one in the sidebar.</p>
        </main>
      )}
    </div>
  );
}

function Skeleton({ board }: { board: Ref }) {
  return (
    <div className="editor-skeleton" aria-busy="true">
      <h1>{board.name}</h1>
      <p className="muted">{board.group || "Ungrouped"} · Loading editor…</p>
    </div>
  );
}
