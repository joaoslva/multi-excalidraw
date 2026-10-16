import { useEffect, useRef, useState } from "react";

export function NameInput(p: { label: string; initial?: string; onSubmit: (v: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(p.initial ?? "");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
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
