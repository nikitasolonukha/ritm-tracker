"use client";

import { KeyRound } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

export default function UpdatePasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const client = createClient();
    client.auth.getSession().then(({ data }) => setReady(Boolean(data.session)));
    const { data: subscription } = client.auth.onAuthStateChange((_event, session) => setReady(Boolean(session)));
    return () => subscription.subscription.unsubscribe();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    if (password.length < 8) { setError("Пароль должен содержать минимум 8 символов"); setBusy(false); return; }
    if (password !== confirmation) { setError("Пароли не совпадают"); setBusy(false); return; }
    const { error: updateError } = await createClient().auth.updateUser({ password });
    if (updateError) setError(updateError.message);
    else { setMessage("Пароль изменён. Теперь можно войти."); setPassword(""); setConfirmation(""); }
    setBusy(false);
  }

  return <main className="shell authShell"><section className="panel authPanel"><p className="eyebrow">Ритм</p><h1>Новый пароль</h1><p className="muted">Открой эту страницу по ссылке из письма восстановления.</p>{!isSupabaseConfigured && <p className="storageMessage">Supabase пока не настроен в окружении.</p>}{isSupabaseConfigured && !ready && <p className="storageMessage">Ссылка восстановления недействительна или истекла.</p>}<form onSubmit={submit} className="authForm"><label>Новый пароль<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} autoComplete="new-password" /></label><label>Повтори пароль<input type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required minLength={8} autoComplete="new-password" /></label>{error && <p className="storageMessage" role="alert">{error}</p>}{message && <p className="storageMessage" role="status">{message}</p>}<button className="primary" disabled={busy || !ready}><KeyRound size={18} /> {busy ? "Сохраняю…" : "Сохранить пароль"}</button></form><a className="textButton" href="/login">Вернуться ко входу</a></section></main>;
}
