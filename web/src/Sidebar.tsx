import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import { formatRoute } from "./route";
import type { BoardEntry, Ref, Tree } from "./types";

type Adding = { kind: "group" } | { kind: "board"; group: string } | null;

interface Props {
  tree: Tree;
  selected: Ref | null;
  onTree: (t: Tree) => void;
  onOpen: (ref: Ref) => void;
}

export function Sidebar({ tree, selected, onTree, onOpen }: Props) {
  const [adding, setAdding] = useState<Adding>(null);
  const [error, setError] = useState<string | null>(null);

  const start = (next: Adding) => {
    setError(null);
    setAdding(next);
  };

  const submit = async (what: NonNullable<Adding>, raw: string) => {
    const name = raw.trim();
    if (!name) return;
    try {
      if (what.kind === "group") {
        await api.createGroup(name);
      } else {
        await api.createBoard({ group: what.group, name });
      }
      setAdding(null);
      setError(null);
      onTree(await api.tree());
      if (what.kind === "board") onOpen({ group: what.group, name });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : `Request failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const empty = tree.groups.length === 0 && tree.ungrouped.length === 0;
  const target = selected?.group || "Ungrouped";

  return (
    <nav className="sidebar" aria-label="Boards">
      <div className="actions">
        <button type="button" onClick={() => start({ kind: "group" })}>New group</button>
        <button type="button" onClick={() => start({ kind: "board", group: selected?.group ?? "" })} title={`Creates in ${target}`}>New board</button>
      </div>
      {adding && (
        <NameInput
          label={adding.kind === "group" ? "New group name" : `New board name (in ${adding.group || "Ungrouped"})`}
          onSubmit={(v) => submit(adding, v)}
          onCancel={() => {
            setAdding(null);
            setError(null);
          }}
        />
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {empty && <p className="empty">No boards yet.</p>}
      <BoardList group="" title="Ungrouped" boards={tree.ungrouped} selected={selected} onAdd={start} hideWhenEmpty />
      {tree.groups.map((g) => (
        <BoardList key={g.name} group={g.name} title={g.name} boards={g.boards} selected={selected} onAdd={start} />
      ))}
    </nav>
  );
}

function BoardList(p: {
  group: string;
  title: string;
  boards: BoardEntry[];
  selected: Ref | null;
  onAdd: (next: Adding) => void;
  hideWhenEmpty?: boolean;
}) {
  if (p.hideWhenEmpty && p.boards.length === 0) return null;
  return (
    <section className="group">
      <div className="group-head">
        <h2>{p.title}</h2>
        <button type="button" className="add" aria-label={`New board in ${p.title}`} onClick={() => p.onAdd({ kind: "board", group: p.group })}>
          +
        </button>
      </div>
      {p.boards.length === 0 ? (
        <p className="empty small">Empty</p>
      ) : (
        <ul>
          {p.boards.map((b) => {
            const current = p.selected?.group === p.group && p.selected.name === b.name;
            return (
              <li key={b.name}>
                <a href={formatRoute({ group: p.group, name: b.name })} aria-current={current ? "page" : undefined}>
                  {b.name}
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function NameInput(p: { label: string; onSubmit: (v: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <input
      ref={ref}
      className="name-input"
      aria-label={p.label}
      placeholder={p.label}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") p.onSubmit(value);
        else if (e.key === "Escape") p.onCancel();
      }}
    />
  );
}
