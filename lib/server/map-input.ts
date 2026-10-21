import "server-only";
import { ApiError } from "@/lib/server/http";
import type { MapOperation } from "@/lib/thematic/operations";
import type { ThematicMap } from "@/lib/thematic/types";

const MAX_OPERATIONS = 50;
const MAX_SEGMENTS_PER_OPERATION = 500;
const text = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !value || value.length > 500) throw new ApiError(400, "invalid_request", `Campo inválido: ${label}.`);
  return value;
};

// Valida a forma das operações vindas do cliente. A data de "ignorar" é definida pelo servidor, nunca pelo cliente.
export function parseOperations(raw: unknown, now: () => Date = () => new Date()): MapOperation[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_OPERATIONS) throw new ApiError(400, "invalid_request", `Envie de 1 a ${MAX_OPERATIONS} alterações.`);
  return raw.map((item): MapOperation => {
    if (!item || typeof item !== "object") throw new ApiError(400, "invalid_request", "Alteração malformada.");
    const op = item as Record<string, unknown>;
    switch (op.op) {
      case "rename": return { op: "rename", nodeId: text(op.nodeId, "nodeId"), title: text(op.title, "title") };
      case "merge": return { op: "merge", targetId: text(op.targetId, "targetId"), sourceId: text(op.sourceId, "sourceId") };
      case "move": return { op: "move", nodeId: text(op.nodeId, "nodeId"), parentId: op.parentId === null ? null : text(op.parentId, "parentId") };
      case "moveCoverage": return { op: "moveCoverage", segmentId: text(op.segmentId, "segmentId"), toNodeId: text(op.toNodeId, "toNodeId") };
      case "split": {
        if (!Array.isArray(op.segmentIds) || !op.segmentIds.length || op.segmentIds.length > MAX_SEGMENTS_PER_OPERATION) throw new ApiError(400, "invalid_request", "Campo inválido: segmentIds.");
        return { op: "split", nodeId: text(op.nodeId, "nodeId"), segmentIds: op.segmentIds.map((id) => text(id, "segmentIds")), title: text(op.title, "title") };
      }
      case "ignore": return { op: "ignore", nodeId: text(op.nodeId, "nodeId"), reason: text(op.reason, "reason"), at: now().toISOString() };
      case "unignore": return { op: "unignore", nodeId: text(op.nodeId, "nodeId") };
      default: throw new ApiError(400, "invalid_request", "Alteração desconhecida.");
    }
  });
}

export const coveredSegmentIds = (map: ThematicMap): string[] => map.nodes.flatMap((node) => node.coverage.map((item) => item.segmentId));
