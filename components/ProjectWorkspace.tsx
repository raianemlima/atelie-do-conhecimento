"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import type { Project } from "@/lib/local-store";
import { createProject, listProjects } from "@/lib/supabase/data-store";

export function ProjectWorkspace() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { listProjects().then(setProjects).catch((error: Error) => setMessage(error.message)); }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true); setMessage(null);
    try {
      const project = await createProject({ name: name.trim(), subject: subject.trim(), description: description.trim() });
      setProjects((current) => [project, ...current]); setName(""); setSubject(""); setDescription("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível criar o projeto."); }
    finally { setBusy(false); }
  }

  return <div className="workspace"><div className="page-intro"><div><p className="eyebrow">ORGANIZAÇÃO</p><h1>Projetos de estudo</h1><p>Comece pelo contexto. Cada projeto é um espaço para uma investigação com começo, meio e autoria.</p></div><span className="count-pill">{projects.length} {projects.length === 1 ? "projeto" : "projetos"}</span></div>
    <div className="workspace-grid"><section className="panel form-panel"><div className="panel-heading"><div><p className="eyebrow">NOVO PROJETO</p><h2>Dar forma a uma ideia</h2></div><span className="panel-number">01</span></div><form onSubmit={submit}><label>Nome do projeto<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Direito Constitucional" required /></label><label>Disciplina ou assunto<input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Ex.: Controle de constitucionalidade" /></label><label>Contexto <span className="optional">opcional</span><textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="O que você quer compreender ou construir?" rows={4} /></label><button className="button primary full" type="submit" disabled={busy}>{busy ? "Salvando…" : "Criar projeto"} <span>+</span></button></form></section>
      <section className="project-list"><div className="list-heading"><div><p className="eyebrow">SEUS PROJETOS</p><h2>Em andamento</h2></div></div>{projects.length === 0 ? <div className="empty-state"><span>✦</span><h3>Seu primeiro projeto começa aqui</h3><p>Preencha o formulário ao lado para criar um espaço de estudo.</p></div> : <div className="cards-list">{projects.map((project) => <article className="project-card" key={project.id}><div className="project-symbol">{project.name.slice(0, 1).toUpperCase()}</div><div className="project-info"><h3>{project.name}</h3><p>{project.subject || "Sem assunto definido"}</p>{project.description && <small>{project.description}</small>}</div><Link className="text-link" href="/materiais">Abrir →</Link></article>)}</div>}</section></div>
    {message && <div className="import-message error"><span>!</span>{message}</div>}<div className="data-note"><span>⌁</span><p><strong>Persistência protegida.</strong> Os projetos são gravados no Supabase com políticas RLS vinculadas à sua conta. Aplique a migração SQL antes de usar esta área.</p></div>
  </div>;
}
