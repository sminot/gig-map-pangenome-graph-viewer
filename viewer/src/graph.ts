import Graph from "graphology";
import type { GraphData, NodeRow } from "./loader";

export interface BuildResult {
  graph: Graph;
  binIds: string[];
  genomeIds: string[];
}

export function buildGraph(data: GraphData): BuildResult {
  const graph = new Graph({ type: "undirected", multi: false });

  const binIds: string[] = [];
  const genomeIds: string[] = [];

  for (const n of data.nodes) {
    graph.addNode(n.id, {
      label: n.label,
      kind: n.kind,
      x: n.x,
      y: n.y,
      size: defaultSize(n),
      color: defaultColor(n),
      type: n.kind === "genome" ? "ring" : "circle",
      attrs: n.attrs,
    });
    if (n.kind === "bin") binIds.push(n.id);
    else genomeIds.push(n.id);
  }

  for (const e of data.edges) {
    if (!graph.hasNode(e.source) || !graph.hasNode(e.target)) continue;
    if (graph.hasEdge(e.source, e.target)) continue;
    graph.addEdge(e.source, e.target, {
      size: 0.4 + e.weight * 1.6,
      color: "rgba(120, 140, 180, 0.25)",
      weight: e.weight,
    });
  }

  return { graph, binIds, genomeIds };
}

function defaultSize(n: NodeRow): number {
  if (n.kind === "genome") return 6;
  const nGenes = Number(n.attrs["n_genes"] ?? 1);
  return 3 + Math.sqrt(Math.max(1, nGenes)) * 1.8;
}

function defaultColor(n: NodeRow): string {
  return n.kind === "genome" ? "#f0883e" : "#58a6ff";
}
