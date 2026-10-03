"use client";

import Link from "next/link";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type ComponentType, type ReactNode } from "react";

type IconType = ComponentType<{ size?: number }>;

/** Заголовок экрана: надпись сверху, название и действия справа — всегда с подписями. */
export function PageHeader({ eyebrow, title, actions }: { eyebrow?: ReactNode; title: ReactNode; actions?: ReactNode }) {
  return <header className="pageHeader">
    <div>{eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}<h1>{title}</h1></div>
    {actions ? <div className="headerActions">{actions}</div> : null}
  </header>;
}

/** Действие в шапке: иконка и короткая подпись, чтобы было понятно без догадок. */
export function HeaderAction({ href, icon: Icon, label, onClick, ariaLabel }: { href?: string; icon: IconType; label: string; onClick?: () => void; ariaLabel?: string }) {
  const content = <><Icon size={18} /><span>{label}</span></>;
  if (href) return <Link className="headerAction" href={href} aria-label={ariaLabel ?? label}>{content}</Link>;
  return <button type="button" className="headerAction" onClick={onClick} aria-label={ariaLabel ?? label}>{content}</button>;
}

export function Notice({ tone = "info", children, role }: { tone?: "info" | "success" | "warning" | "error"; children: ReactNode; role?: "alert" | "status" }) {
  const Icon = tone === "success" ? CheckCircle2 : tone === "info" ? Info : AlertTriangle;
  return <p className={`notice ${tone}`} role={role ?? (tone === "error" || tone === "warning" ? "alert" : "status")}><Icon size={18} /><span>{children}</span></p>;
}

export function StatTile({ value, label }: { value: ReactNode; label: string }) {
  return <div className="statTile"><strong>{value}</strong><span>{label}</span></div>;
}

export function EmptyState({ icon: Icon, title, children, action }: { icon?: IconType; title: string; children?: ReactNode; action?: ReactNode }) {
  return <section className="emptyState">{Icon ? <span className="emptyIcon"><Icon size={26} /></span> : null}<h2>{title}</h2>{children ? <p>{children}</p> : null}{action}</section>;
}

type ConfirmOptions = { title?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean };
type ConfirmRequest = { message: string; options: ConfirmOptions; resolve: (value: boolean) => void };

/**
 * Замена window.confirm: `const { confirm, dialog } = useConfirm()`,
 * затем `if (!(await confirm("…", { danger: true }))) return;` и `{dialog}` в разметке.
 */
export function useConfirm() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const confirm = useCallback((message: string, options: ConfirmOptions = {}) => new Promise<boolean>((resolve) => setRequest({ message, options, resolve })), []);
  const answer = (value: boolean) => { request?.resolve(value); setRequest(null); };
  const dialog = request ? <ConfirmDialog request={request} onAnswer={answer} /> : null;
  return { confirm, dialog };
}

function ConfirmDialog({ request, onAnswer }: { request: ConfirmRequest; onAnswer: (value: boolean) => void }) {
  const { message, options } = request;
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onAnswer(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  return <div className="dialogBackdrop" onClick={() => onAnswer(false)}>
    <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(event) => event.stopPropagation()}>
      <h2 id={titleId}>{options.title ?? (options.danger ? "Подтвердите удаление" : "Подтвердите действие")}</h2>
      <p>{message}</p>
      <div className="dialogActions">
        <button type="button" className="secondary" ref={cancelRef} onClick={() => onAnswer(false)}>{options.cancelLabel ?? "Отмена"}</button>
        <button type="button" className={options.danger ? "primary dangerSolid" : "primary"} onClick={() => onAnswer(true)}>{options.confirmLabel ?? (options.danger ? "Удалить" : "Продолжить")}</button>
      </div>
    </div>
  </div>;
}
