"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const navigation = [
  { href: "/projetos", label: "Projetos", icon: "▦" },
  { href: "/fontes", label: "Biblioteca de fontes", icon: "⌕" },
  { href: "/documentos", label: "Documentos", icon: "▤" },
  { href: "/materiais", label: "Materiais", icon: "✦" },
  { href: "/dados", label: "Dados e backup", icon: "⇄" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname(); const router = useRouter();
  if (pathname === "/login" || pathname === "/configuracao") return <>{children}</>;
  async function signOut() { await createClient().auth.signOut(); router.replace("/login"); }
  return <div className="app-shell"><aside className="sidebar"><Link className="brand" href="/"><span className="brand-mark">A</span><span><strong>Ateliê</strong><small>do conhecimento</small></span></Link><p className="eyebrow sidebar-label">ESPAÇO DE ESTUDO</p><nav className="main-nav" aria-label="Navegação principal">{navigation.map((item) => { const active = pathname === item.href || pathname.startsWith(`${item.href}/`); return <Link className={active ? "nav-link active" : "nav-link"} href={item.href} key={item.href}><span>{item.icon}</span>{item.label}</Link>; })}</nav><div className="sidebar-note"><span className="privacy-dot" /><div><strong>Sessão protegida</strong><p>Dados filtrados pela sua conta e pelas políticas RLS.</p></div></div></aside><div className="main-column"><header className="topbar"><div><span className="topbar-kicker">ATELIÊ PESSOAL</span><span className="topbar-title">Pesquisa com propósito</span></div><div className="topbar-actions"><span className="local-badge"><span className="status-dot" /> sessão protegida</span><button className="logout-button" onClick={signOut}>Sair</button></div></header><main className="content">{children}</main></div></div>;
}
