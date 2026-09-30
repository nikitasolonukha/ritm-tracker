"use client";

import { Eye, EyeOff, KeyRound, LogIn, UserPlus } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import Link from "next/link";
import { authErrorMessage, normalizeEmail, safeAuthRedirect, validateEmail } from "@/lib/auth";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [action, setAction] = useState<"login" | "recovery" | null>(null);
  const [resetSent, setResetSent] = useState(false);
  const [visible, setVisible] = useState(false);
  const [destination, setDestination] = useState("/today");
  const [hydrated, setHydrated] = useState(false);
  const busyRef = useRef(false);
  const busy = action !== null;

  useEffect(() => {
    setHydrated(true);
    const params = new URL(window.location.href).searchParams;
    setDestination(safeAuthRedirect(params.get("next")));
    const initialEmail = params.get("email");
    if (initialEmail && !validateEmail(initialEmail)) setEmail(initialEmail);
    if (["session-expired", "expired"].includes(params.get("reason") ?? "")) setNotice("Сессия истекла. Войдите снова; ваши несинхронизированные записи сохранены на этом устройстве.");
    if (params.get("reason") === "unavailable") setNotice(authErrorMessage("unavailable"));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current || !isSupabaseConfigured) return;
    const invalid = validateEmail(email);
    if (invalid) { setError(invalid); return; }
    busyRef.current = true; setAction("login"); setError(""); setResetSent(false);
    try {
      const { error: authError } = await createClient().auth.signInWithPassword({ email: normalizeEmail(email), password });
      if (authError) throw authError;
      window.location.assign(destination);
    } catch (authError) { setError(authErrorMessage((authError as { code?: string } | null)?.code)); }
    finally { busyRef.current = false; setAction(null); }
  }

  async function requestReset() {
    if (busyRef.current || !isSupabaseConfigured) return;
    const invalid = validateEmail(email);
    if (invalid) { setError("Введите корректный email для восстановления пароля."); return; }
    busyRef.current = true; setAction("recovery"); setError(""); setResetSent(false);
    try {
      const { error: resetError } = await createClient().auth.resetPasswordForEmail(normalizeEmail(email), { redirectTo: `${window.location.origin}/update-password` });
      if (resetError) throw resetError;
      setResetSent(true);
    } catch (resetError) { setError(authErrorMessage((resetError as { code?: string } | null)?.code)); }
    finally { busyRef.current = false; setAction(null); }
  }

  return <main className="shell authShell"><section className="authPanel">
    <h1>Ритм</h1><h2>Вход</h2>
    {!isSupabaseConfigured && <p className="storageMessage" role="status">Сервис временно не настроен.</p>}
    {notice && <p className="storageMessage" role="status">{notice}</p>}
    <noscript><p role="alert">Для входа нужен JavaScript. Включите его и обновите страницу.</p></noscript>
    <form method="post" onSubmit={submit} className="authForm" aria-busy={busy}>
      <label htmlFor="login-email">Email<input id="login-email" name="email" type="email" inputMode="email" value={email} onChange={(event) => { setEmail(event.target.value); setResetSent(false); }} required autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={254} disabled={!hydrated || busy || !isSupabaseConfigured} /></label>
      <label htmlFor="login-password">Пароль<span className="passwordField"><input id="login-password" name="password" type={visible ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="current-password" maxLength={128} disabled={!hydrated || busy || !isSupabaseConfigured} /><button className="iconButton" type="button" aria-controls="login-password" aria-pressed={visible} aria-label={visible ? "Скрыть пароль" : "Показать пароль"} title={visible ? "Скрыть пароль" : "Показать пароль"} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={20} /> : <Eye size={20} />}</button></span></label>
      {error && <p className="storageMessage" role="alert">{error}</p>}
      {resetSent && <p className="storageMessage" role="status">Если аккаунт существует, письмо для восстановления отправлено. Проверьте почту, включая папку «Спам».</p>}
      <button className="primary" disabled={!hydrated || busy || !isSupabaseConfigured}><LogIn size={18} /> {action === "login" ? "Вхожу…" : "Войти"}</button>
    </form>
    <button className="secondary" type="button" onClick={requestReset} disabled={!hydrated || busy || !isSupabaseConfigured}><KeyRound size={16} /> {action === "recovery" ? "Отправляю письмо…" : "Забыли пароль?"}</button>
    <Link className="secondary" href={`/register?next=${encodeURIComponent(destination)}`}><UserPlus size={18} />Создать аккаунт</Link>
  </section></main>;
}
