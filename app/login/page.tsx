"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { const { error: signInError } = await createClient().auth.signInWithPassword({ email, password }); if (signInError) throw signInError; const nextPath = new URLSearchParams(window.location.search).get("next") || "/"; router.replace(nextPath); router.refresh(); }
    catch (signInError) { setError(signInError instanceof Error ? "E-mail ou senha inválidos." : "Não foi possível entrar."); }
    finally { setBusy(false); }
  }
  return <main className="auth-page"><div className="auth-card"><span className="brand-mark">A</span><p className="eyebrow">ATELIÊ DO CONHECIMENTO</p><h1>Entrar no seu espaço</h1><p>Este ambiente é privado. O cadastro de usuários é controlado diretamente no Supabase.</p><form onSubmit={submit} className="auth-form"><label>E-mail<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label><label>Senha<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>{error && <p className="auth-error">{error}</p>}<button className="button primary full" type="submit" disabled={busy}>{busy ? "Entrando…" : "Entrar"}<span>→</span></button></form><p className="auth-footnote">A sessão é mantida por cookies seguros do Supabase. Não há cadastro público nesta aplicação.</p></div></main>;
}
