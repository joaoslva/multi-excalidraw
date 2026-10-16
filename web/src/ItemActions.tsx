import { useEffect, useRef, useState } from "react";
import { NameInput } from "./NameInput";
import type { Ref } from "./types";

export type Target = { kind: "board"; ref: Ref } | { kind: "group"; name: string; boards: number };

export type Command = { kind: "rename"; to: string } | { kind: "move"; toGroup: string } | { kind: "delete" };

const nameOf = (t: Target) => (t.kind === "board" ? t.ref.name : t.name);

export function ActionsButton(p: { target: Target; expanded: boolean; onToggle: () => void; onClose: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const { expanded, onClose } = p;
  // Focus is on the button right after opening, so Escape must be heard on the document.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      onClose();
      ref.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [expanded, onClose]);
  const label = p.target.kind === "board" ? `Actions for ${nameOf(p.target)}` : `Actions for group ${nameOf(p.target)}`;
  return (
    <button ref={ref} type="button" className="more" aria-label={label} aria-expanded={expanded} onClick={p.onToggle}>
      ⋯
    </button>
  );
}

type Mode = "menu" | "rename" | "move" | "delete";

/** `groups` are all group names. The caller closes the panel on success and keeps it open on error. */
export function ActionsPanel(p: { target: Target; groups: string[]; run: (c: Command) => void; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>("menu");
  const { target } = p;
  const name = nameOf(target);

  if (mode === "rename") {
    return (
      <div className="panel">
        <NameInput
          label="Rename to"
          initial={name}
          onSubmit={(v) => {
            const to = v.trim();
            if (!to || to === name) p.onClose();
            else p.run({ kind: "rename", to });
          }}
          onCancel={p.onClose}
        />
      </div>
    );
  }
  if (mode === "move" && target.kind === "board") {
    return <MovePanel from={target.ref.group} groups={p.groups} run={p.run} />;
  }
  if (mode === "delete") {
    return (
      <div className="panel">
        <p>{target.kind === "board" ? `Move "${name}" to .trash?` : `Move group "${name}" and its ${target.boards} board(s) to .trash?`}</p>
        <div className="panel-buttons">
          <button type="button" autoFocus onClick={() => p.run({ kind: "delete" })}>
            {target.kind === "board" ? "Delete board" : "Delete group"}
          </button>
          <button type="button" onClick={p.onClose}>Cancel</button>
        </div>
      </div>
    );
  }
  return (
    <div className="panel panel-buttons">
      <button type="button" onClick={() => setMode("rename")}>Rename</button>
      {target.kind === "board" && <button type="button" onClick={() => setMode("move")}>Move…</button>}
      <button type="button" onClick={() => setMode("delete")}>Delete…</button>
    </div>
  );
}

function MovePanel(p: { from: string; groups: string[]; run: (c: Command) => void }) {
  const options = [{ value: "", label: "Ungrouped" }, ...p.groups.map((g) => ({ value: g, label: g }))].filter((o) => o.value !== p.from);
  const [to, setTo] = useState(options[0]?.value ?? "");
  return (
    <div className="panel panel-buttons">
      <select aria-label="Move to group" value={to} onChange={(e) => setTo(e.target.value)} autoFocus>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <button type="button" disabled={options.length === 0} onClick={() => p.run({ kind: "move", toGroup: to })}>Move</button>
    </div>
  );
}
