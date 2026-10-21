"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { STAGE_LABELS, type JobView, type PublicStage } from "@/lib/pipeline/dto";
import { advanceJobStep, listActiveJobs, startJob } from "@/lib/pipeline/client";

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

function groupStages(stages: PublicStage[]) {
  const groups = new Map<string, PublicStage[]>();
  stages.forEach((stage) => groups.set(stage.stage, [...(groups.get(stage.stage) ?? []), stage]));
  return [...groups.entries()].map(([stage, rows]) => {
    const failed = rows.find((row) => row.status === "failed");
    const retrying = rows.find((row) => row.status === "pending" && row.attempts > 0);
    const running = rows.some((row) => row.status === "running");
    const done = rows.filter((row) => row.status === "succeeded" || row.status === "skipped").length;
    const state = failed ? "failed" : done === rows.length ? "done" : retrying ? "retry" : running || done > 0 ? "running" : "pending";
    return { stage, done, total: rows.length, state, cached: rows.some((row) => row.cacheHit), detail: failed?.error ?? retrying?.error ?? null };
  });
}

export function PipelineProgress({ documentIds, defaultName }: { documentIds: string[]; defaultName: string }) {
  const [view, setView] = useState<JobView | null>(null);
  const [name, setName] = useState(defaultName);
  const [message, setMessage] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const stopped = useRef(false);
  const driving = useRef<string | null>(null);

  const drive = useCallback(async (jobId: string) => {
    if (driving.current === jobId) return;
    driving.current = jobId;
    try {
      while (!stopped.current) {
        const { outcome, view: next } = await advanceJobStep(jobId);
        if (next) setView(next);
        if (outcome.kind === "done" || outcome.kind === "failed") break;
        if (outcome.kind === "waiting") await sleep(Math.max(1000, Date.parse(outcome.retryAt) - Date.now()));
        else if (outcome.kind === "busy") await sleep(1500);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível continuar o processamento.");
    } finally {
      driving.current = null;
    }
  }, []);

  // Recarregar a página não perde nada: o estado vem do banco e o processamento é retomado de onde parou.
  useEffect(() => {
    stopped.current = false;
    listActiveJobs().then(({ jobs }) => { if (jobs[0]) { setView(jobs[0]); void drive(jobs[0].job.id); } }).catch((error: Error) => setMessage(error.message));
    return () => { stopped.current = true; };
  }, [drive]);

  async function start() {
    setStarting(true);
    setMessage(null);
    try {
      const { view: created } = await startJob({ name: name.trim(), documentIds });
      setView(created);
      if (created.job.status === "queued" || created.job.status === "running") void drive(created.job.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível iniciar o processamento.");
    } finally {
      setStarting(false);
    }
  }

  const active = view && (view.job.status === "queued" || view.job.status === "running");
  return <section className="panel pipeline-panel" aria-live="polite">
    <div className="pipeline-head"><div><p className="eyebrow">NOVO PIPELINE · EM TESTE</p><h2>Montar caderno</h2><p>Processa os {documentIds.length} documento(s) do filtro atual em etapas curtas, com retomada automática.</p></div>
      <div className="pipeline-start"><input aria-label="Nome do caderno" value={name} onChange={(event) => setName(event.target.value)} maxLength={200} /><button className="button primary" onClick={start} disabled={starting || Boolean(active) || !documentIds.length || !name.trim()}>{starting ? "Iniciando…" : "Processar"}</button></div></div>
    {message && <div className="import-message error"><span>!</span>{message}</div>}
    {view && <><div className="progress-bar" role="progressbar" aria-valuenow={view.progress.percent} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${view.progress.percent}%` }} /></div>
      <p className="pipeline-summary">{view.job.status === "succeeded" ? "Concluído" : view.job.status === "failed" ? "Falhou" : "Em andamento"} · {view.progress.done} de {view.progress.total} etapas ({view.progress.percent}%)</p>
      <ul className="stage-list">{groupStages(view.stages).map((group) => <li key={group.stage} className={`stage-row ${group.state}`}><span className="stage-name">{STAGE_LABELS[group.stage] ?? group.stage}</span><span className="stage-count">{group.done}/{group.total}{group.cached ? " · cache" : ""}</span><span className={`stage-chip ${group.state}`}>{{ done: "Concluída", running: "Em execução", pending: "Aguardando", retry: "Nova tentativa", failed: "Falhou" }[group.state]}</span>{group.detail && <small className="stage-detail">{group.detail}</small>}</li>)}</ul>
      {view.job.status === "failed" && <p className="no-text-warning"><strong>O processamento parou.</strong> {view.job.error} Clique em Processar para tentar de novo: etapas já concluídas não são refeitas.</p>}</>}
  </section>;
}
