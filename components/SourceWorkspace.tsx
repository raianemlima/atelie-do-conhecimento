"use client";

import { FormEvent, useEffect, useState } from "react";
import type { Source, SourceType } from "@/lib/local-store";
import { createSource, listSources } from "@/lib/supabase/data-store";

const sourceTypes: SourceType[] = ["Livro", "Artigo", "Legislação", "Jurisprudência", "Curso", "Notícia", "Outro"];

export function SourceWorkspace() {
  const [sources, setSources] = useState<Source[]>([]);
  const [title, setTitle] = useState(""); const [type, setType] = useState<SourceType>("Artigo"); const [url, setUrl] = useState(""); const [notes, setNotes] = useState("");
  const [message, setMessage] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { listSources().then(setSources).catch((error: Error) => setMessage(error.message)); }, []);
  async function submit(event: FormEvent) { event.preventDefault(); if (!title.trim()) return; setBusy(true); setMessage(null); try { const source = await createSource({ title: title.trim(), type, url: url.trim(), notes: notes.trim() }); setSources((current) => [source, ...current]); setTitle(""); setUrl(""); setNotes(""); } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível salvar a fonte."); } finally { setBusy(false); } }
  return <div className="workspace"><div className="page-intro"><div><p className="eyebrow">REFERÊNCIAS</p><h1>Biblioteca de fontes</h1><p>Registre de onde veio cada ideia. A rastreabilidade começa no cuidado com a origem.</p></div><span className="count-pill">{sources.length} {sources.length === 1 ? "fonte" : "fontes"}</span></div>
    <div className="workspace-grid"><section className="panel form-panel"><div className="panel-heading"><div><p className="eyebrow">NOVA FONTE</p><h2>Adicionar referência</h2></div><span className="panel-number">02</span></div><form onSubmit={submit}><label>Título da fonte<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Constituição Federal comentada" required /></label><label>Tipo<select value={type} onChange={(e) => setType(e.target.value as SourceType)}>{sourceTypes.map((item) => <option key={item}>{item}</option>)}</select></label><label>URL <span className="optional">opcional</span><input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." /></label><label>Observações <span className="optional">opcional</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Edição, autores, páginas, data de acesso..." rows={4} /></label><button className="button primary full" type="submit" disabled={busy}>{busy ? "Salvando…" : "Salvar fonte"} <span>+</span></button></form></section>
      <section className="project-list"><div className="list-heading"><div><p className="eyebrow">CATÁLOGO</p><h2>Fontes registradas</h2></div></div>{sources.length === 0 ? <div className="empty-state"><span>⌕</span><h3>A biblioteca está pronta</h3><p>Registre livros, links, artigos e outros materiais que sustentam sua pesquisa.</p></div> : <div className="cards-list">{sources.map((source) => <article className="source-card" key={source.id}><span className="type-tag">{source.type}</span><div className="source-info"><h3>{source.title}</h3>{source.url && <a href={source.url} target="_blank" rel="noreferrer">{source.url.replace(/^https?:\/\//, "")}</a>}{source.notes && <p>{source.notes}</p>}</div><span className="source-date">{new Date(source.createdAt).toLocaleDateString("pt-BR")}</span></article>)}</div>}</section></div>
    {message && <div className="import-message error"><span>!</span>{message}</div>}<div className="data-note"><span>⌁</span><p><strong>Sem coleta automática.</strong> A fonte é catalogada no Supabase e só será usada em tarefas escolhidas por você.</p></div>
  </div>;
}
