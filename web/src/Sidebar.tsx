import { useCallback, useState } from "react";
import { api } from "./api";
import { ActionsButton, ActionsPanel, type Command, type Target } from "./ItemActions";
import { NameInput } from "./NameInput";
import { formatRoute } from "./route";
import type { Op } from "./selection";
import type { BoardEntry, Ref, Tree } from "./types";
import { messageOf, useTreeOps } from "./useTreeOps";

type Adding = { kind: "group" } | { kind: "board"; group: string } | null;

interface Props {
  tree: Tree;
  selected: Ref | null;
  onTree: (t: Tree) => void;
  onOpen: (ref: Ref) => void;
  onSelect: (ref: Ref | null) => void;
}

const keyOf = (t: Target) => JSON.stringify(t.kind === "board" ? [t.ref.group, t.ref.name] : [t.name]);

function toOp(t: Target, c: Command): Op {
  if (t.kind === "group") return c.kind === "rename" ? { kind: "renameGroup", from: t.name, to: c.to } : { kind: "deleteGroup", name: t.name };
  if (c.kind === "rename") return { kind: "renameBoard", from: t.ref, to: { group: t.ref.group, name: c.to } };
  if (c.kind === "move") return { kind: "moveBoard", from: t.ref, to: { group: c.toGroup, name: t.ref.name } };
  return { kind: "deleteBoard", ref: t.ref };
}

export function Sidebar({ tree, selected, onTree, onOpen, onSelect }: Props) {
  const [adding, setAdding] = useState<Adding>(null);
  const [open, setOpen] = useState<Target | null>(null);
  const { error, setError, run } = useTreeOps(selected, onTree, onSelect);

  const start = (next: Adding) => {
    setError(null);
    setOpen(null);
    setAdding(next);
  };
  const close = useCallback(() => {
    setOpen(null);
    setError(null);
  }, [setError]);
  const toggle = (t: Target) => {
    setError(null);
    setAdding(null);
    setOpen(open && keyOf(open) === keyOf(t) ? null : t);
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
      setError(messageOf(e));
    }
  };

  const perform = async (t: Target, c: Command) => {
    if (await run(toOp(t, c))) setOpen(null);
  };

  const row = { open, toggle, close, perform, groups: tree.groups.map((g) => g.name) };
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
      <BoardList group="" title="Ungrouped" boards={tree.ungrouped} selected={selected} onAdd={start} row={row} hideWhenEmpty />
      {tree.groups.map((g) => (
        <BoardList key={g.name} group={g.name} title={g.name} boards={g.boards} selected={selected} onAdd={start} row={row} />
      ))}
    </nav>
  );
}

interface RowProps {
  open: Target | null;
  toggle: (t: Target) => void;
  close: () => void;
  perform: (t: Target, c: Command) => void;
  groups: string[];
}

function BoardList(p: {
  group: string;
  title: string;
  boards: BoardEntry[];
  selected: Ref | null;
  onAdd: (next: Adding) => void;
  row: RowProps;
  hideWhenEmpty?: boolean;
}) {
  const { open, toggle, close, perform, groups } = p.row;
  if (p.hideWhenEmpty && p.boards.length === 0) return null;
  const isOpen = (t: Target) => open !== null && keyOf(open) === keyOf(t);
  const groupTarget: Target = { kind: "group", name: p.group, boards: p.boards.length };
  const panel = (t: Target) => isOpen(t) && <ActionsPanel target={t} groups={groups} run={(c) => perform(t, c)} onClose={close} />;
  return (
    <section className="group">
      <div className="group-head">
        <h2>{p.title}</h2>
        <button type="button" className="add" aria-label={`New board in ${p.title}`} onClick={() => p.onAdd({ kind: "board", group: p.group })}>
          +
        </button>
        {p.group !== "" && <ActionsButton target={groupTarget} expanded={isOpen(groupTarget)} onToggle={() => toggle(groupTarget)} onClose={close} />}
      </div>
      {p.group !== "" && panel(groupTarget)}
      {p.boards.length === 0 ? (
        <p className="empty small">Empty</p>
      ) : (
        <ul>
          {p.boards.map((b) => {
            const ref = { group: p.group, name: b.name };
            const t: Target = { kind: "board", ref };
            const current = p.selected?.group === p.group && p.selected.name === b.name;
            return (
              <li key={b.name}>
                <div className="row">
                  <a href={formatRoute(ref)} aria-current={current ? "page" : undefined}>
                    {b.name}
                  </a>
                  <ActionsButton target={t} expanded={isOpen(t)} onToggle={() => toggle(t)} onClose={close} />
                </div>
                {panel(t)}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
