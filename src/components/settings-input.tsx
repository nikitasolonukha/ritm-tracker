"use client";

import { useState } from "react";
import { commitDraftValue } from "@/lib/tracker";

export function SettingsInput({ value, onCommit, numeric, placeholder }: {
  value: string | number | null | undefined;
  onCommit: (value: string) => void;
  numeric?: "weight" | "reps";
  placeholder?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState(false);
  function commit() {
    if (draft === null) return;
    const parsed = numeric ? commitDraftValue(draft, numeric) : null;
    if (parsed?.status === "invalid") { setError(true); return; }
    onCommit(parsed?.status === "valid" ? String(parsed.value) : draft);
    setDraft(null);
    setError(false);
  }
  return <><input value={draft ?? value ?? ""} placeholder={placeholder} inputMode={numeric === "weight" ? "decimal" : numeric === "reps" ? "numeric" : "text"} aria-invalid={error || undefined}
    onChange={(event) => { setDraft(event.target.value); setError(false); }} onBlur={commit}
    onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
    {error && <small className="fieldError" role="alert">{numeric === "weight" ? "Введите вес, например 12,5" : "Введите целое число повторений"}</small>}</>;
}
