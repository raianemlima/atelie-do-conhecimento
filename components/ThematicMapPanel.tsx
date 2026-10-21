"use client";

import { useCallback, useEffect, useState } from "react";
import { confirmMap, editMap, getMap, type ClientOperation, type MapResponse } from "@/lib/thematic/client";
import type { MapNode } from "@/lib/thematic/types";

const formatChars = (chars: number) => (chars >= 1000 ? `${(chars / 1000).toFixed(1).replace(".", ",")} mil caracteres` : `${chars} caracteres`);

type Draft = { nodeId: string; kind: "rename" | "ignore" | "merge"; value: string };

export function ThematicMapPanel({ notebookId }: { notebookId: string }) {
  const [data, setData] = useState<MapResponse | null | undefined>(undefined);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setData(await getMap(notebookId)); }
    catch (error) { setData(null); setMessage({ tone: "error", text: error instanceof Error ? error.message : "Não foi possível carregar o mapa." }); }
  }, [notebookId]);
  useEffect(() => {
    let active = true;
    getMap(notebookId).then((result) => { if (active) setData(result); }).catch((error: Error) => { if (active) { setData(null); setMessage({ tone: "error", text: error.message }); } });
    return () => { active = false; };
  }, [notebookId]);

  async function run(operations: ClientOperation[], success: string) {
    if (!data) return;
    setBusy(true);
    setMessage(null);
    try {
      setData(await editMap(notebookId, data.latest.version, operations));
      setDraft(null);
      setMessage({ tone: "success", text: success });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Não foi possível salvar a alteração." });
      await load();
    } finally { setBusy(false); }
  }

  async function confirm() {
    if (!data) return;
    setBusy(true);
    setMessage(null);
    try { setData(await confirmMap(notebookId, data.latest.version)); setMessage({ tone: "success", text: "Mapa confirmado para a redação." }); }
    catch (error) { setMessage({ tone: "error", text: error instanceof Error ? error.message : "Não foi possível confirmar." }); }
    finally { setBusy(false); }
  }

  if (data === undefined) return <section className="panel map-panel"><p className="option-hint">Carregando o mapa temático…</p></section>;
  if (data === null) return <section className="panel map-panel"><p className="eyebrow">MAPA TEMÁTICO</p><p className="option-hint">O mapa aparece aqui quando o processamento termina.</p>{message && <div className="import-message error"><span>!</span>{message.text}</div>}</section>;

  const { latest, versions } = data;
  const nodes = latest.map.nodes;
  const sameLevel = (node: MapNode) => nodes.filter((other) => other.level === node.level && other.id !== node.id && !other.ignored);
  const documentTitle = (id: string) => latest.map.documents.find((document) => document.id === id)?.title ?? id;

  const row = (node: MapNode) => {
    const editing = draft?.nodeId === node.id ? draft : null;
    return <li key={node.id} className={`map-node level-${node.level}${node.ignored ? " ignored" : ""}`}>
      <div className="map-node-head">
        <strong>{node.title}</strong>
        <span className="map-badges">
          {node.needsReview && !node.ignored && <span className="stage-chip retry">revisar</span>}
          {node.singleSource && <span className="stage-chip pending">fonte única</span>}
          {node.ignored && <span className="stage-chip failed">ignorado</span>}
          {node.origin === "edited" && <span className="stage-chip done">editado</span>}
        </span>
      </div>
      <p className="map-meta">{node.documentIds.map(documentTitle).join(" · ") || "sem conteúdo próprio"} · {node.coverage.length} {node.coverage.length === 1 ? "trecho" : "trechos"} · {formatChars(node.chars)}</p>
      {node.aliases.length > 0 && <p className="map-meta">Também aparece como: {node.aliases.join(" · ")}</p>}
      {node.ignored && <p className="map-meta">Motivo: {node.ignored.reason}</p>}
      {editing ? <div className="map-edit">
        {editing.kind === "merge"
          ? <select aria-label="Mesclar em" value={editing.value} onChange={(event) => setDraft({ ...editing, value: event.target.value })}><option value="">Mesclar em…</option>{sameLevel(node).map((other) => <option key={other.id} value={other.id}>{other.title}</option>)}</select>
          : <input aria-label={editing.kind === "rename" ? "Novo título" : "Motivo"} value={editing.value} maxLength={editing.kind === "rename" ? 200 : 300} onChange={(event) => setDraft({ ...editing, value: event.target.value })} placeholder={editing.kind === "rename" ? "Novo título" : "Por que ignorar?"} />}
        <button className="button primary" disabled={busy || !editing.value.trim()} onClick={() => run(editing.kind === "rename" ? [{ op: "rename", nodeId: node.id, title: editing.value }] : editing.kind === "ignore" ? [{ op: "ignore", nodeId: node.id, reason: editing.value }] : [{ op: "merge", targetId: editing.value, sourceId: node.id }], editing.kind === "rename" ? "Título atualizado." : editing.kind === "ignore" ? "Item marcado como ignorado (continua registrado no mapa)." : "Itens mesclados.")}>Salvar</button>
        <button className="button ghost" disabled={busy} onClick={() => setDraft(null)}>Cancelar</button>
      </div> : <div className="map-actions">
        <button className="button ghost" disabled={busy} onClick={() => setDraft({ nodeId: node.id, kind: "rename", value: node.title })}>Renomear</button>
        {!node.ignored && sameLevel(node).length > 0 && <button className="button ghost" disabled={busy} onClick={() => setDraft({ nodeId: node.id, kind: "merge", value: "" })}>Mesclar em…</button>}
        {node.ignored ? <button className="button ghost" disabled={busy} onClick={() => run([{ op: "unignore", nodeId: node.id }], "Item reconsiderado.")}>Reconsiderar</button> : <button className="button ghost" disabled={busy} onClick={() => setDraft({ nodeId: node.id, kind: "ignore", value: "" })}>Ignorar</button>}
      </div>}
    </li>;
  };

  return <section className="panel map-panel" aria-live="polite">
    <div className="pipeline-head"><div><p className="eyebrow">MAPA TEMÁTICO · REVISÃO ANTES DA REDAÇÃO</p><h2>{latest.map.discipline}</h2>
      <p>Versão {latest.version} · {latest.origin === "auto" ? "gerada automaticamente" : "editada por você"} · {latest.status === "confirmed" ? "confirmada" : "rascunho"} · {latest.map.stats.themes} temas · {latest.map.stats.subthemes} subtemas · {latest.map.stats.needsReview} para revisar</p></div>
      <button className="button primary" onClick={confirm} disabled={busy || latest.status === "confirmed"}>{latest.status === "confirmed" ? "Confirmado" : "Confirmar este mapa"}</button></div>
    {message && <div className={message.tone === "error" ? "import-message error" : "import-message success"}><span>{message.tone === "error" ? "!" : "✓"}</span>{message.text}</div>}
    {latest.map.warnings.map((warning) => <p key={warning} className="no-text-warning">{warning}</p>)}
    <ul className="map-tree">{nodes.map(row)}</ul>
    {latest.changeLog.length > 0 && <details className="pipeline-options"><summary>O que mudou nesta versão ({latest.changeLog.length})</summary><ul className="map-log">{latest.changeLog.map((line) => <li key={line}>{line}</li>)}</ul></details>}
    <p className="option-hint">Nenhum item é apagado: ignorar e mesclar deixam registro. Versões anteriores ({versions.length}) continuam guardadas.</p>
  </section>;
}
