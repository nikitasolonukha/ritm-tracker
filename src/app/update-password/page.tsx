"use client";

import { Notice } from "@/components/ui";
import Link from "next/link";
import { KeyRound, LogIn } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { authErrorMessage } from "@/lib/auth";

export default function UpdatePasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(false);
  const [ready, setReady] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let mounted = true;
    const client = createClient();
    void client.auth.getSession().then(({ data }) => { if (mounted) { setReady(Boolean(data.session)); setChecked(true); } })
      .catch(() => { if (mounted) { setError(authErrorMessage("unavailable")); setChecked(true); } });
    const { data } = client.auth.onAuthStateChange((_event, session) => { if (mounted) { setReady(Boolean(session)); setChecked(true); } });
    return () => { mounted = false; data.subscription.unsubscribe(); };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current || !ready) return;
    setError(""); setMessage("");
    if (password.length < 8 || password.length > 128 || !password.trim()) { setError("Пароль должен содержать от 8 до 128 символов."); return; }
    if (password !== confirmation) { setError("Пароли не совпадают."); return; }
    busyRef.current = true; setBusy(true);
    try {
      const { error: updateError } = await createClient().auth.updateUser({ password });
      if (updateError) { setError(authErrorMessage(updateError.code)); return; }
      setMessage("Пароль изменён."); setPassword(""); setConfirmation("");
    } catch { setError(authErrorMessage("unavailable")); }
    finally { busyRef.current = false; setBusy(false); }
  }

  return <main className="shell authShell"><section className="authPanel">
    <h1>Ритм</h1><h2>Новый пароль</h2>
    {!isSupabaseConfigured && <Notice tone="warning">Сервис временно не настроен.</Notice>}
    {isSupabaseConfigured && !checked && <p role="status">Проверяю ссылку…</p>}
    {checked && !ready && <Notice tone="warning">Ссылка восстановления недействительна или истекла.</Notice>}
    <form method="post" onSubmit={submit} className="authForm">
      <label>Новый пароль<input type="password" name="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} maxLength={128} autoComplete="new-password" disabled={busy || !ready} /></label>
      <label>Повторите пароль<input type="password" name="confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required minLength={8} maxLength={128} autoComplete="new-password" disabled={busy || !ready} /></label>
      {error && <Notice tone="warning">{error}</Notice>}{message && <Notice tone="info">{message}</Notice>}
      <button className="primary" disabled={busy || !ready}><KeyRound size={18} />{busy ? "Сохраняю…" : "Сохранить пароль"}</button>
    </form>
    <Link className="secondary" href="/login"><LogIn size={18} />Вернуться ко входу</Link>
  </section></main>;
}
