import { extractCitations } from "@/lib/citations/extract";
import type { CitationRegistry } from "@/lib/citations/types";

export type CitationCheck = { raw: string; key: string; label: string; status: "registered" | "unregistered" };

// Anti-invenção: toda citação presente em um texto gerado precisa existir no registro construído a partir das fontes.
export function verifyCitations(text: string, registry: CitationRegistry): { ok: boolean; checks: CitationCheck[]; unregistered: CitationCheck[] } {
  const known = new Set(registry.citations.map((citation) => citation.key));
  const checks = extractCitations(text).map((item): CitationCheck => ({ raw: item.raw, key: item.key, label: item.label, status: known.has(item.key) ? "registered" : "unregistered" }));
  const unregistered = checks.filter((check) => check.status === "unregistered");
  return { ok: unregistered.length === 0, checks, unregistered };
}
