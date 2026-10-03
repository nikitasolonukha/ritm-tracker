"use client";

import { Notice } from "@/components/ui";
import Link from "next/link";
import { Eye, EyeOff, LogIn, UserPlus } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { authErrorMessage, normalizeEmail, safeAuthRedirect, validateRegistration } from "@/lib/auth";

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(false);
  const [error, setError] = useState("");
  const [destination, setDestination] = useState("/today");
  const [hydrated, setHydrated] = useState(false);
  const busyRef = useRef(false);
  const createdRef = useRef(false);

  useEffect(() => { setHydrated(true); setDestination(safeAuthRedirect(new URL(window.location.href).searchParams.get("next"))); }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current || !isSupabaseConfigured) return;
    const invalid = validateRegistration(email, password);
    if (invalid) { setError(invalid); return; }
    busyRef.current = true; setBusy(true); setError("");
    try {
      if (!createdRef.current) {
        const response = await fetch("/api/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: normalizeEmail(email), password }), signal: AbortSignal.timeout(20_000) });
        const result: { created?: boolean; error?: string } = await response.json();
        if (!response.ok) { setError(authErrorMessage(result.error)); return; }
        if (result.created !== true) { setError(authErrorMessage("unavailable")); return; }
        createdRef.current = true; setCreated(true);
      }
      const signed = await createClient().auth.signInWithPassword({ email: normalizeEmail(email), password });
      if (signed.error) { setError("Аккаунт создан, но войти сейчас не удалось. Попробуйте ещё раз или откройте страницу входа."); return; }
      window.location.assign(destination);
    } catch {
      setError(createdRef.current ? "Аккаунт создан. Повторите вход с этим email и паролем." : "Не удалось подтвердить создание аккаунта. Попробуйте войти с этим email и паролем или повторите регистрацию.");
    } finally { busyRef.current = false; setBusy(false); }
  }

  return <main className="shell authShell"><section className="authPanel">
    <h1>Ритм</h1><h2>Создать аккаунт</h2>
    {!isSupabaseConfigured && <Notice tone="info">Сервис временно не настроен.</Notice>}
    {created && <Notice tone="info">Аккаунт создан. Подтверждение почты не требуется.</Notice>}
    <noscript><p role="alert">Для регистрации нужен JavaScript. Включите его и обновите страницу.</p></noscript>
    <form method="post" className="authForm" onSubmit={submit} aria-busy={busy}>
      <label htmlFor="register-email">Email<input id="register-email" name="email" type="email" inputMode="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={254} required disabled={!hydrated || busy || created || !isSupabaseConfigured} /></label>
      <label htmlFor="register-password">Пароль<span className="passwordField"><input id="register-password" name="password" type={visible ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={8} maxLength={128} required disabled={!hydrated || busy || created || !isSupabaseConfigured} /><button className="iconButton" type="button" onClick={() => setVisible(!visible)} aria-controls="register-password" aria-pressed={visible} aria-label={visible ? "Скрыть пароль" : "Показать пароль"} title={visible ? "Скрыть пароль" : "Показать пароль"}>{visible ? <EyeOff size={20} /> : <Eye size={20} />}</button></span></label>
      {!created && <p className="muted">Не менее 8 символов.</p>}
      {error && <Notice tone="warning">{error}</Notice>}
      <button className="primary" disabled={!hydrated || busy || !isSupabaseConfigured}>{created ? <LogIn size={18} /> : <UserPlus size={18} />}{busy ? created ? "Вхожу…" : "Создаю аккаунт…" : created ? "Войти в аккаунт" : "Создать аккаунт"}</button>
    </form>
    <Link className="secondary" href={`/login?next=${encodeURIComponent(destination)}${created ? `&email=${encodeURIComponent(normalizeEmail(email))}` : ""}`}><LogIn size={18} />{created ? "Открыть вход" : "Уже есть аккаунт"}</Link>
  </section></main>;
}
