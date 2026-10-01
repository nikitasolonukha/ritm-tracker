"use client";

import { ChevronDown } from "lucide-react";
import { Children, isValidElement, useEffect, useId, useRef, useState, type ReactNode } from "react";

type Choice = { value: string; label: string; disabled: boolean };

function choicesFrom(children: ReactNode): Choice[] {
  const choices: Choice[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement<{ value?: string | number; disabled?: boolean; children?: ReactNode }>(child)) return;
    const value = child.props.value == null ? "" : String(child.props.value);
    choices.push({ value, label: String(child.props.children ?? ""), disabled: Boolean(child.props.disabled) });
  });
  return choices;
}

export function AppSelect({ value, onChange, children }: { value: string | number; onChange: (value: string) => void; children: ReactNode }) {
  const selected = String(value);
  const [desktop, setDesktop] = useState(false);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();
  const choices = choicesFrom(children);
  const current = choices.find((choice) => choice.value === selected) ?? choices[0];

  useEffect(() => {
    const media = window.matchMedia("(min-width: 900px)");
    const apply = () => setDesktop(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (!open) return;
    const pointer = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", pointer);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", pointer); document.removeEventListener("keydown", key); };
  }, [open]);

  return <div className={`appSelect${desktop ? " desktop" : ""}`} ref={root}>
    <select value={selected} aria-hidden={desktop || undefined} tabIndex={desktop ? -1 : undefined} onChange={(event) => onChange(event.target.value)}>{children}</select>
    {desktop && <button type="button" className="appSelectButton" aria-haspopup="listbox" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((shown) => !shown)}><span>{current?.label}</span><ChevronDown size={18} /></button>}
    {desktop && open && <ul className="appSelectMenu" id={listId} role="listbox">{choices.map((choice) => <li key={`${choice.value}:${choice.label}`} role="presentation"><button type="button" role="option" aria-selected={choice.value === selected} disabled={choice.disabled} onClick={() => { onChange(choice.value); setOpen(false); }}>{choice.label}</button></li>)}</ul>}
  </div>;
}
