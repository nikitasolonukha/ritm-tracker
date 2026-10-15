"use client";

import Link from "next/link";
import { Minus, Plus } from "lucide-react";
import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ComponentType, type ReactNode } from "react";

type IconType = ComponentType<{ size?: number }>;
type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const buttonClass = (variant: Variant, size: Size, block?: boolean, extra?: string) =>
  ["btn", `btn-${variant}`, size === "md" ? "" : `btn-${size}`, block ? "btn-block" : "", extra ?? ""].filter(Boolean).join(" ");

export function Button({ variant = "secondary", size = "md", icon: Icon, block, className, children, type = "button", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; icon?: IconType; block?: boolean }) {
  return <button type={type} className={buttonClass(variant, size, block, className)} {...rest}>{Icon ? <Icon size={size === "lg" ? 22 : 20} /> : null}{children}</button>;
}

export function LinkButton({ href, variant = "secondary", size = "md", icon: Icon, block, children, ariaLabel }: { href: string; variant?: Variant; size?: Size; icon?: IconType; block?: boolean; children: ReactNode; ariaLabel?: string }) {
  return <Link href={href} className={buttonClass(variant, size, block)} aria-label={ariaLabel}>{Icon ? <Icon size={20} /> : null}{children}</Link>;
}

/** Иконка-кнопка. Подпись обязательна: она читается скринридером и показывается подсказкой. */
export function IconButton({ label, icon: Icon, href, plain, size = 22, ...rest }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & { label: string; icon: IconType; href?: string; plain?: boolean; size?: number }) {
  const className = `iconBtn${plain ? " iconBtn-plain" : ""}`;
  if (href) return <Link href={href} className={className} aria-label={label} title={label}><Icon size={size} /></Link>;
  return <button type="button" className={className} aria-label={label} title={label} {...rest}><Icon size={size} /></button>;
}

export function Card({ tone, pad, className, children }: { tone?: "raised" | "accent"; pad?: boolean; className?: string; children: ReactNode }) {
  return <div className={["card", tone ? `card-${tone}` : "", pad ? "card-pad" : "", className ?? ""].filter(Boolean).join(" ")}>{children}</div>;
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (value: T) => void; options: Array<{ value: T; label: string; disabled?: boolean }>; label: string }) {
  return <div className="seg" role="group" aria-label={label}>{options.map((option) => <button type="button" key={option.value} aria-pressed={value === option.value} disabled={option.disabled} onClick={() => onChange(option.value)}>{option.label}</button>)}</div>;
}

const sectionTabs = [
  { id: "overview", href: "/progress", label: "Обзор" },
  { id: "journal", href: "/journal", label: "Журнал" },
  { id: "calendar", href: "/calendar", label: "Календарь" },
  { id: "exercises", href: "/exercises", label: "Упражнения" },
] as const;

/** Разделы «Прогресса»: одна полоса вкладок на все четыре экрана. */
export function ProgressTabs({ active }: { active: (typeof sectionTabs)[number]["id"] }) {
  return <nav className="seg progressTabs" aria-label="Разделы прогресса">{sectionTabs.map((tab) => <Link key={tab.id} href={tab.href} aria-current={tab.id === active ? "page" : undefined}>{tab.label}</Link>)}</nav>;
}

export function Chip({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" className="chip" aria-pressed={pressed} onClick={onClick}>{children}</button>;
}

/** Круглые кнопки −/+ вокруг значения. Значение приходит готовым узлом, чтобы экран сам решал, что внутри. */
export function Stepper({ onMinus, onPlus, minusLabel, plusLabel, minusDisabled, plusDisabled, children, className }: { onMinus: () => void; onPlus: () => void; minusLabel: string; plusLabel: string; minusDisabled?: boolean; plusDisabled?: boolean; children: ReactNode; className?: string }) {
  return <div className={`stepper${className ? ` ${className}` : ""}`}>
    <button type="button" className="stepperBtn" aria-label={minusLabel} disabled={minusDisabled} onClick={onMinus}><Minus size={26} /></button>
    <div className="stepperValue">{children}</div>
    <button type="button" className="stepperBtn" aria-label={plusLabel} disabled={plusDisabled} onClick={onPlus}><Plus size={26} /></button>
  </div>;
}

/** Нижний лист поверх экрана: меню действий, подтверждения, короткие формы. */
export function Sheet({ open, onClose, title, children, label }: { open: boolean; onClose: () => void; title?: string; children: ReactNode; label?: string }) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    window.setTimeout(() => panel.current?.querySelector<HTMLElement>("button, input, [tabindex]")?.focus(), 0);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { onClose(); return; }
      if (event.key !== "Tab" || !panel.current) return;
      const items = Array.from(panel.current.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href], [tabindex]:not([tabindex='-1'])")).filter((item) => !item.hasAttribute("disabled"));
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); previous?.focus(); };
  }, [open, onClose]);
  if (!open) return null;
  return <div className="sheetBackdrop" onClick={onClose}>
    <div ref={panel} className="sheet" role="dialog" aria-modal="true" aria-labelledby={title ? titleId : undefined} aria-label={title ? undefined : label} onClick={(event) => event.stopPropagation()}>
      <div className="sheetHandle" aria-hidden="true" />
      {title ? <h2 id={titleId}>{title}</h2> : null}
      {children}
    </div>
  </div>;
}

export function Ring({ value, max, size = 72, stroke = 8, ok, label, sub }: { value: number; max: number; size?: number; stroke?: number; ok?: boolean; label?: ReactNode; sub?: string }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return <div className="ring" style={{ width: size, height: size }} role="img" aria-label={`${value} из ${max}`}>
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle className="ringTrack" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} />
      <circle className={`ringValue${ok ? " ok" : ""}`} cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} strokeDasharray={circumference} strokeDashoffset={circumference * (1 - ratio)} />
    </svg>
    <div className="ringLabel"><strong>{label ?? value}</strong>{sub ? <small>{sub}</small> : null}</div>
  </div>;
}
