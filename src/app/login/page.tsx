"use client";

import { LogIn } from "lucide-react";
import { type FormEvent, useState } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try { const { error: authError } = await createClient().auth.signInWithPassword({ email, password }); if (authError) throw authError; window.location.assign("/"); }
    catch (authError) { setError(authError instanceof Error ? authError.message : "Не удалось войти"); }
    finally { setBusy(false); }
  }
  return <main className="shell authShell"><section className="panel authPanel"><p className="eyebrow">Ритм</p><h1>Вход</h1><p className="muted">Только владелец приложения.</p>{!isSupabaseConfigured && <p className="storageMessage">Supabase пока не настроен в окружении.</p>}<form onSubmit={submit} className="authForm"><label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="username" /></label><label>Пароль<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="current-password" /></label>{error && <p className="storageMessage" role="alert">{error}</p>}<button className="primary" disabled={busy || !isSupabaseConfigured}><LogIn size={18} /> {busy ? "Вхожу…" : "Войти"}</button></form></section></main>;
}
