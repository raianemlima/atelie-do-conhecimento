import { statsOf } from "@/lib/thematic/build";
import type { CoverageItem, MapNode, ThematicMap } from "@/lib/thematic/types";

export type MapOperation =
  | { op: "rename"; nodeId: string; title: string }
  | { op: "merge"; targetId: string; sourceId: string }
  | { op: "move"; nodeId: string; parentId: string | null }
  | { op: "moveCoverage"; segmentId: string; toNodeId: string }
  | { op: "split"; nodeId: string; segmentIds: string[]; title: string }
  | { op: "ignore"; nodeId: string; reason: string; at: string }
  | { op: "unignore"; nodeId: string };

export class MapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MapError";
  }
}

export const MAX_TITLE_LENGTH = 200;
export const MAX_REASON_LENGTH = 300;

const clone = (map: ThematicMap): ThematicMap => structuredClone(map);
const cleanTitle = (title: unknown): string => {
  const value = typeof title === "string" ? title.replace(/\s+/g, " ").trim() : "";
  if (!value || value.length > MAX_TITLE_LENGTH) throw new MapError(`O título deve ter de 1 a ${MAX_TITLE_LENGTH} caracteres.`);
  return value;
};

function find(map: ThematicMap, id: string): MapNode {
  const node = map.nodes.find((candidate) => candidate.id === id);
  if (!node) throw new MapError("Item do mapa não encontrado.");
  return node;
}

const childrenOf = (map: ThematicMap, id: string) => map.nodes.filter((node) => node.parentId === id);
const uniqueCoverage = (items: CoverageItem[]) => [...new Map(items.map((item) => [item.segmentId, item])).values()];
const addAlias = (node: MapNode, alias: string) => { if (alias !== node.title && !node.aliases.includes(alias)) node.aliases.push(alias); };

// Recalcula o que deriva do resto (totais, fontes, ordem) para o mapa nunca ficar inconsistente.
export function normalizeMap(map: ThematicMap): ThematicMap {
  for (const node of map.nodes) {
    node.coverage = uniqueCoverage(node.coverage);
    node.chars = node.coverage.reduce((total, item) => total + item.chars, 0);
    node.documentIds = [...new Set(node.coverage.map((item) => item.documentId))];
    node.singleSource = map.documents.length > 1 && node.documentIds.length === 1;
  }
  const themes = map.nodes.filter((node) => node.level === 1).sort((a, b) => a.order - b.order);
  const ordered = themes.flatMap((theme) => [theme, ...map.nodes.filter((node) => node.parentId === theme.id).sort((a, b) => a.order - b.order)]);
  // Nunca descarta item em silêncio: o que ficou órfão vai para o fim e é apontado por validateMap.
  map.nodes = [...ordered, ...map.nodes.filter((node) => !ordered.includes(node))];
  map.nodes.forEach((node, index) => { node.order = index; });
  map.stats = statsOf(map.nodes);
  return map;
}

// Lista de problemas (vazia = mapa íntegro). Com expectedSegmentIds, exige cobertura exata: cada trecho em um único item.
export function validateMap(map: ThematicMap, expectedSegmentIds?: string[]): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const node of map.nodes) {
    if (ids.has(node.id)) problems.push(`Identificador repetido: ${node.id}.`);
    ids.add(node.id);
    if (!node.title.trim()) problems.push("Há um item sem título.");
    if (node.level === 1 && node.parentId !== null) problems.push(`O tema "${node.title}" não pode ter pai.`);
    if (node.level === 2) {
      const parent = map.nodes.find((candidate) => candidate.id === node.parentId);
      if (!parent || parent.level !== 1) problems.push(`O subtema "${node.title}" precisa estar dentro de um tema.`);
    }
  }
  const seen = new Map<string, number>();
  map.nodes.forEach((node) => node.coverage.forEach((item) => seen.set(item.segmentId, (seen.get(item.segmentId) ?? 0) + 1)));
  for (const [segmentId, count] of seen) if (count > 1) problems.push(`O trecho ${segmentId} aparece em mais de um item.`);
  if (expectedSegmentIds) {
    const expected = new Set(expectedSegmentIds);
    for (const id of expected) if (!seen.has(id)) problems.push(`O trecho ${id} não está coberto por nenhum item.`);
    for (const id of seen.keys()) if (!expected.has(id)) problems.push(`O trecho ${id} não existe nas fontes.`);
  }
  return problems;
}

function apply(map: ThematicMap, operation: MapOperation, log: string[]): void {
  switch (operation.op) {
    case "rename": {
      const node = find(map, operation.nodeId);
      const title = cleanTitle(operation.title);
      if (title === node.title) return;
      const previous = node.title;
      node.title = title;
      node.aliases = node.aliases.filter((alias) => alias !== title);
      addAlias(node, previous);
      log.push(`Renomeado "${previous}" para "${title}".`);
      node.needsReview = false;
      node.origin = "edited";
      return;
    }
    case "merge": {
      const target = find(map, operation.targetId);
      const source = find(map, operation.sourceId);
      if (target.id === source.id) throw new MapError("Escolha dois itens diferentes para mesclar.");
      if (target.level !== source.level) throw new MapError("Só é possível mesclar itens do mesmo nível (tema com tema, subtema com subtema).");
      if (target.ignored || source.ignored) throw new MapError("Desfaça o 'ignorar' antes de mesclar.");
      target.coverage.push(...source.coverage);
      addAlias(target, source.title);
      source.aliases.forEach((alias) => addAlias(target, alias));
      childrenOf(map, source.id).forEach((child) => { child.parentId = target.id; });
      map.nodes = map.nodes.filter((node) => node.id !== source.id);
      target.needsReview = false;
      target.origin = "edited";
      log.push(`"${source.title}" foi mesclado em "${target.title}".`);
      return;
    }
    case "move": {
      const node = find(map, operation.nodeId);
      if (operation.parentId === null) {
        if (node.level === 1) return;
        node.level = 1;
        node.parentId = null;
        node.order = map.nodes.length;
        log.push(`"${node.title}" virou um tema.`);
      } else {
        const parent = find(map, operation.parentId);
        if (parent.level !== 1) throw new MapError("Um item só pode ser movido para dentro de um tema.");
        if (parent.id === node.id) throw new MapError("Um item não pode ser movido para dentro de si mesmo.");
        if (node.level === 1 && childrenOf(map, node.id).length) throw new MapError("Este tema tem subtemas; mova ou mescle os subtemas antes (o mapa tem no máximo dois níveis).");
        node.level = 2;
        node.parentId = parent.id;
        log.push(`"${node.title}" foi movido para dentro de "${parent.title}".`);
      }
      node.needsReview = false;
      node.origin = "edited";
      return;
    }
    case "moveCoverage": {
      const to = find(map, operation.toNodeId);
      const from = map.nodes.find((node) => node.coverage.some((item) => item.segmentId === operation.segmentId));
      if (!from) throw new MapError("Trecho não encontrado no mapa.");
      if (from.id === to.id) return;
      const item = from.coverage.find((candidate) => candidate.segmentId === operation.segmentId) as CoverageItem;
      from.coverage = from.coverage.filter((candidate) => candidate.segmentId !== operation.segmentId);
      to.coverage.push(item);
      from.origin = "edited";
      to.origin = "edited";
      log.push(`Um trecho foi movido de "${from.title}" para "${to.title}".`);
      return;
    }
    case "split": {
      const node = find(map, operation.nodeId);
      const wanted = new Set(operation.segmentIds);
      const moving = node.coverage.filter((item) => wanted.has(item.segmentId));
      if (!wanted.size || moving.length !== wanted.size) throw new MapError("Escolha trechos que pertençam a este item.");
      if (moving.length === node.coverage.length) throw new MapError("Para dividir, deixe ao menos um trecho no item original.");
      const title = cleanTitle(operation.title);
      node.coverage = node.coverage.filter((item) => !wanted.has(item.segmentId));
      node.origin = "edited";
      const id = `${node.id}-s${map.nodes.length}`;
      map.nodes.push({ id, level: node.level, parentId: node.parentId, title, aliases: [], confidence: 1, needsReview: false, singleSource: false, ignored: null, coverage: moving, documentIds: [], chars: 0, order: node.order + 0.5, origin: "edited" });
      log.push(`"${node.title}" foi dividido; nasceu "${title}".`);
      return;
    }
    case "ignore": {
      const node = find(map, operation.nodeId);
      const reason = typeof operation.reason === "string" ? operation.reason.trim() : "";
      if (!reason || reason.length > MAX_REASON_LENGTH) throw new MapError(`Informe o motivo para ignorar (até ${MAX_REASON_LENGTH} caracteres).`);
      node.ignored = { reason, at: operation.at };
      node.origin = "edited";
      log.push(`"${node.title}" foi marcado como ignorado: ${reason}`);
      return;
    }
    case "unignore": {
      const node = find(map, operation.nodeId);
      if (!node.ignored) return;
      node.ignored = null;
      node.origin = "edited";
      log.push(`"${node.title}" voltou a ser considerado.`);
      return;
    }
    default:
      throw new MapError("Operação desconhecida.");
  }
}

// Aplica a lista inteira ou nada (atômico): se qualquer operação ou o resultado final for inválido, lança MapError.
export function applyOperations(map: ThematicMap, operations: MapOperation[], expectedSegmentIds?: string[]): { map: ThematicMap; log: string[] } {
  if (!operations.length) throw new MapError("Nenhuma alteração informada.");
  const next = clone(map);
  const log: string[] = [];
  for (const operation of operations) apply(next, operation, log);
  normalizeMap(next);
  const problems = validateMap(next, expectedSegmentIds);
  if (problems.length) throw new MapError(`A alteração deixaria o mapa inconsistente: ${problems[0]}`);
  return { map: next, log };
}
