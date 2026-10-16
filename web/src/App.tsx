import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { formatRoute, parseRoute } from "./route";
import { Sidebar } from "./Sidebar";
import type { Ref, Tree } from "./types";

export function App({ initial }: { initial: Tree }) {
  const [tree, setTree] = useState(initial);
  const [selected, setSelected] = useState<Ref | null>(() => parseRoute(location.hash) ?? (location.hash ? null : initial.last));

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
      <main className="main">
        {selected ? (
          <section className="card">
            <h1>{selected.name}</h1>
            <p className="muted">{selected.group || "Ungrouped"}</p>
            <p>The editor arrives in the next step.</p>
          </section>
        ) : (
          <p className="empty">Select a board, or create one in the sidebar.</p>
        )}
      </main>
    </div>
  );
}
